import "server-only";
import { db, parseJson } from "@/lib/db";
import { getContent } from "@/lib/content";
import { teamStatus } from "@/lib/rounds";
import { initialMarket, initialState, processCycle, scoreVentures, type EngineContract } from "./engine";
import { parseConfig, roleOf, TEMPLATES, type Decision, type EconomyConfig, type MarketState, type VentureResult, type VentureState } from "./model";

export const ventureState = (raw: string) => parseJson<VentureState | null>(raw, null);
export const marketState = (raw: string, cfg: EconomyConfig) => {
  const m = parseJson<Partial<MarketState>>(raw, {});
  return m.cycle === undefined ? initialMarket(cfg) : (m as MarketState);
};

/** Contracts that run in `cycle`. */
export function activeIn<T extends { status: string; startCycle: number; cycles: number }>(contracts: T[], cycle: number) {
  return contracts.filter((c) => (c.status === "ACTIVE" || c.status === "COMPLETED") && c.startCycle <= cycle && c.startCycle + c.cycles - 1 >= cycle);
}

export async function createEconomy(roundId: string, template = "ev-mobility") {
  const cfg = (TEMPLATES[template] ?? TEMPLATES["ev-mobility"]).config;
  const econ = await db.simEconomy.create({ data: { roundId, template, config: JSON.stringify(cfg), market: JSON.stringify(initialMarket(cfg)) } });
  await db.simEvent.createMany({ data: cfg.scheduledEvents.map((e) => ({ economyId: econ.id, cycle: e.cycle, title: e.title, description: e.description, effects: JSON.stringify(e.effects) })) });
  return econ;
}

/** Teams that may play: paid, not disqualified, complete, and qualified if the round requires it. */
export async function eligibleTeams(roundId: string) {
  const [round, teams, quals, content] = await Promise.all([
    db.round.findUniqueOrThrow({ where: { id: roundId } }),
    db.team.findMany({ include: { _count: { select: { members: true } } }, orderBy: { createdAt: "asc" } }),
    db.qualification.findMany({ where: { roundId } }),
    getContent(),
  ]);
  return teams.filter((t) => teamStatus(t, t._count.members, content.teamMin) === "PAID" && (!round.restrictToQualified || quals.some((q) => q.teamId === t.id)));
}

/** Deterministic shuffle, then deal roles round-robin so every role is filled before any repeats. */
export async function autoAssign(economyId: string) {
  const econ = await db.simEconomy.findUniqueOrThrow({ where: { id: economyId } });
  if (econ.status !== "SETUP") throw new Error("Roles can only change before the simulation starts.");
  const cfg = parseConfig(econ.config);
  const teams = await eligibleTeams(econ.roundId);
  let h = 2166136261;
  for (const c of econ.id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const order = [...teams];
  for (let i = order.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const j = Math.abs(h) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  await db.$transaction([
    db.simVenture.deleteMany({ where: { economyId } }),
    ...order.map((t, i) => {
      const role = cfg.roles[i % cfg.roles.length];
      return db.simVenture.create({ data: { economyId, teamId: t.id, roleKey: role.key, state: JSON.stringify(initialState(cfg, role)) } });
    }),
  ]);
  return order.length;
}

export async function startSimulation(economyId: string) {
  const econ = await db.simEconomy.findUniqueOrThrow({ where: { id: economyId }, include: { ventures: true } });
  if (econ.status !== "SETUP") throw new Error("The simulation has already started.");
  if (econ.ventures.length < 2) throw new Error("Assign at least two teams first.");
  const cfg = parseConfig(econ.config);
  await db.$transaction([
    ...econ.ventures.map((v) => db.simVenture.update({ where: { id: v.id }, data: { state: JSON.stringify(initialState(cfg, roleOf(cfg, v.roleKey)!)) } })),
    db.simEconomy.update({
      where: { id: economyId },
      data: { status: "OPEN", currentCycle: 1, cycleEndsAt: new Date(Date.now() + cfg.cycleMinutes * 60_000), pausedMs: null, market: JSON.stringify(initialMarket(cfg)) },
    }),
    db.simMessage.create({ data: { economyId, kind: "SYSTEM", body: `The ${cfg.industry} economy is open. Cycle 1 (${cfg.cycleNames[0] ?? "Cycle 1"}) has started: submit your decisions before the window closes.` } }),
  ]);
}

/**
 * Processes the open cycle: runs the engine on every team's decision at once, stores the results,
 * and opens the next cycle (or finishes the game and writes final marks).
 * Only one caller can claim a cycle, so concurrent page loads cannot double-process.
 */
export async function processOpenCycle(economyId: string, opts: { onlyIfExpired?: boolean } = {}) {
  const econ = await db.simEconomy.findUnique({ where: { id: economyId } });
  if (!econ || (econ.status !== "OPEN" && econ.status !== "PAUSED")) return false;
  if (opts.onlyIfExpired && (econ.status !== "OPEN" || !econ.cycleEndsAt || econ.cycleEndsAt > new Date())) return false;
  const cycle = econ.currentCycle;
  const claim = await db.simEconomy.updateMany({ where: { id: economyId, status: econ.status, currentCycle: cycle }, data: { status: "PROCESSING" } });
  if (claim.count !== 1) return false;

  try {
    const cfg = parseConfig(econ.config);
    const [ventures, decisions, contracts, events] = await Promise.all([
      db.simVenture.findMany({ where: { economyId } }),
      db.simDecision.findMany({ where: { economyId, cycle } }),
      db.simContract.findMany({ where: { economyId, status: "ACTIVE" } }),
      db.simEvent.findMany({ where: { economyId, cycle } }),
    ]);
    const running = activeIn(contracts, cycle);
    const engineVentures = ventures.map((v) => ({ id: v.id, roleKey: v.roleKey, state: ventureState(v.state) ?? initialState(cfg, roleOf(cfg, v.roleKey)!) }));
    const out = processCycle({
      cfg,
      cycle,
      market: marketState(econ.market, cfg),
      ventures: engineVentures,
      decisions: Object.fromEntries(decisions.map((d) => [d.ventureId, parseJson<Decision>(d.data, {} as Decision)])),
      contracts: running.map<EngineContract>((c) => ({ id: c.id, sellerId: c.sellerId, buyerId: c.buyerId, units: c.units, unitPrice: c.unitPrice })),
      effects: events.map((e) => parseJson(e.effects, {})),
    });
    const last = cycle >= cfg.cycles;
    await db.$transaction([
      ...engineVentures.map((v) => db.simVenture.update({ where: { id: v.id }, data: { state: JSON.stringify(out.states[v.id] ?? v.state) } })),
      db.simSnapshot.deleteMany({ where: { economyId, cycle } }),
      db.simSnapshot.createMany({
        data: [
          ...Object.entries(out.results).map(([ventureId, r]) => ({ economyId, cycle, ventureId, data: JSON.stringify(r) })),
          { economyId, cycle, ventureId: "MARKET", data: JSON.stringify(out.market) },
        ],
      }),
      ...running.map((c) =>
        db.simContract.update({
          where: { id: c.id },
          data: {
            delivered: { increment: out.contracts[c.id]?.delivered ?? 0 },
            shortfall: { increment: out.contracts[c.id]?.shortfall ?? 0 },
            status: c.startCycle + c.cycles - 1 <= cycle ? "COMPLETED" : "ACTIVE",
          },
        }),
      ),
      db.simMessage.create({
        data: { economyId, kind: "SYSTEM", body: last ? `Cycle ${cycle} processed. The simulation is over: final results are being calculated.` : `Cycle ${cycle} processed. Cycle ${cycle + 1} (${cfg.cycleNames[cycle] ?? `Cycle ${cycle + 1}`}) is open.` },
      }),
      db.simEconomy.update({
        where: { id: economyId },
        data: {
          market: JSON.stringify(out.market),
          status: last ? "FINISHED" : "OPEN",
          currentCycle: last ? cycle : cycle + 1,
          cycleEndsAt: last ? null : new Date(Date.now() + cfg.cycleMinutes * 60_000),
          pausedMs: null,
        },
      }),
    ]);
    if (last) await writeFinalScores(economyId);
    return true;
  } catch (e) {
    await db.simEconomy.update({ where: { id: economyId }, data: { status: econ.status } });
    throw e;
  }
}

/** Marks go into the round's Attempt rows so the shared leaderboard, cut-offs and analytics pick them up. */
export async function writeFinalScores(economyId: string) {
  const econ = await db.simEconomy.findUniqueOrThrow({ where: { id: economyId }, include: { ventures: true } });
  const cfg = parseConfig(econ.config);
  const scores = scoreVentures(cfg, econ.ventures.map((v) => ({ id: v.id, roleKey: v.roleKey, state: ventureState(v.state) ?? initialState(cfg, roleOf(cfg, v.roleKey)!) })));
  const now = new Date();
  await db.$transaction(
    econ.ventures.flatMap((v) => {
      const s = scores.find((x) => x.id === v.id);
      if (!s) return [];
      const answers = JSON.stringify({ roleKey: v.roleKey, roe: s.roe, equity: s.equity, brand: s.brand, reliability: s.reliability, composite: s.composite });
      return [
        db.attempt.upsert({
          where: { roundId_teamId: { roundId: econ.roundId, teamId: v.teamId } },
          create: { roundId: econ.roundId, teamId: v.teamId, startedAt: v.createdAt, submittedAt: now, autoScore: s.marks, answers },
          update: { submittedAt: now, autoScore: s.marks, answers },
        }),
      ];
    }),
  );
}

/** Lazy auto-advance: page loads after the deadline process the cycle (when the organisers enabled it). */
export async function maybeAdvance(economyId: string) {
  const econ = await db.simEconomy.findUnique({ where: { id: economyId }, select: { config: true, status: true, cycleEndsAt: true } });
  if (!econ || econ.status !== "OPEN" || !econ.cycleEndsAt || econ.cycleEndsAt > new Date()) return;
  if (!parseConfig(econ.config).autoAdvance) return;
  await processOpenCycle(economyId, { onlyIfExpired: true });
}

/** Deterministic ±8% noise so purchased intel is useful but not exact. */
function fuzz(value: number, seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return value * (1 + ((Math.abs(h) % 1600) - 800) / 10_000);
}

export async function researchReport(economyId: string, buyerId: string, targetId: string, cycle: number) {
  const [target, snap] = await Promise.all([
    db.simVenture.findUniqueOrThrow({ where: { id: targetId }, include: { team: true } }),
    db.simSnapshot.findFirst({ where: { economyId, ventureId: targetId }, orderBy: { cycle: "desc" } }),
  ]);
  const r = parseJson<VentureResult | null>(snap?.data, null);
  const st = ventureState(target.state);
  const seed = `${buyerId}:${targetId}:${cycle}`;
  const L = (n: number, k: string) => `₹${(fuzz(n, seed + k) / 100_000).toFixed(2)}L`;
  if (!r || !st) return `Research on ${target.team.name}: no trading history yet. Starting cash ${L(st?.cash ?? 0, "c")}, capacity ${st?.capacity ?? "—"} units.`;
  return [
    `Research on ${target.team.name} (estimates, ±8%), based on cycle ${r.cycle}:`,
    `Revenue ${L(r.revenue, "r")} · Profit ${L(r.profit, "p")} · Cash ${L(r.cash, "c")} · Debt ${L(r.debt, "d")}`,
    `Capacity ${Math.round(fuzz(r.capacity, seed + "cap"))} units (+${st.pendingCapacity} coming) · Produced ${Math.round(fuzz(r.produced, seed + "q"))} · Inventory ${Math.round(r.inventory)}`,
    `Contract reliability ${Math.round(r.reliability * 100)}% · Quality index ${r.quality.toFixed(2)}`,
  ].join("\n");
}
