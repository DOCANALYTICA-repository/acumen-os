import "server-only";
import { db, parseJson } from "@/lib/db";
import { teamStatus } from "@/lib/rounds";
import { computeAwards, finalMetrics, initialMarket, initialState, mergePerks, processCycle, scoreVentures, type EngineContract } from "./engine";
import { parseConfig, roleOf, TEMPLATES, type DealKind, type Decision, type EconomyConfig, type MarketState, type Perks, type VentureResult, type VentureState } from "./model";

export const ventureState = (raw: string) => {
  const s = parseJson<VentureState | null>(raw, null);
  return s && typeof s.startEquity === "number" ? s : null;
};
/** During the auction a venture only holds a wallet. */
export const auctionWallet = (raw: string) => parseJson<{ cash?: number }>(raw, {}).cash ?? 0;
export const marketState = (raw: string, cfg: EconomyConfig): MarketState => {
  const m = parseJson<Partial<MarketState>>(raw, {});
  return m.cycle === undefined ? initialMarket(cfg) : ({ ...initialMarket(cfg), ...m } as MarketState);
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
  const [round, teams, quals] = await Promise.all([
    db.round.findUniqueOrThrow({ where: { id: roundId } }),
    db.team.findMany({ include: { _count: { select: { members: true } } }, orderBy: { createdAt: "asc" } }),
    db.qualification.findMany({ where: { roundId } }),
  ]);
  return teams.filter((t) => teamStatus(t, t._count.members) === "PAID" && (!round.restrictToQualified || quals.some((q) => q.teamId === t.id)));
}

function shuffle<T>(items: T[], seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const order = [...items];
  for (let i = order.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const j = Math.abs(h) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** Skip the auction: deal identities round-robin in a deterministic shuffled order. */
export async function autoAssign(economyId: string) {
  const econ = await db.simEconomy.findUniqueOrThrow({ where: { id: economyId } });
  if (econ.status !== "SETUP" && econ.status !== "READY") throw new Error("Identities can only change before the simulation starts.");
  const cfg = parseConfig(econ.config);
  const order = shuffle(await eligibleTeams(econ.roundId), econ.id);
  await db.$transaction([
    db.simAuctionLot.deleteMany({ where: { economyId } }),
    db.simVenture.deleteMany({ where: { economyId } }),
    ...order.map((t, i) => {
      const role = cfg.roles[i % cfg.roles.length];
      return db.simVenture.create({ data: { economyId, teamId: t.id, roleKey: role.key, state: JSON.stringify(initialState(cfg, role)) } });
    }),
    db.simEconomy.update({ where: { id: economyId }, data: { status: "READY" } }),
  ]);
  return order.length;
}

// ---------------- Setup auction ----------------

/** Creates a wallet for every eligible team and the lots: one per identity, then the resources. */
export async function prepareAuction(economyId: string) {
  const econ = await db.simEconomy.findUniqueOrThrow({ where: { id: economyId } });
  if (econ.status !== "SETUP" && econ.status !== "READY") throw new Error("The auction can only be set up before the simulation starts.");
  const cfg = parseConfig(econ.config);
  const teams = await eligibleTeams(econ.roundId);
  if (teams.length < 2) throw new Error("At least two eligible teams are needed.");
  const lots = [
    ...cfg.roles.map((r) => ({ kind: "IDENTITY", key: r.key, name: r.name, description: r.blurb, reserve: cfg.auction.identityReserve })),
    ...cfg.auction.resources.map((r) => ({ kind: "RESOURCE", key: r.key, name: r.name, description: r.description, reserve: r.reserve })),
  ];
  await db.$transaction([
    db.simAuctionLot.deleteMany({ where: { economyId } }),
    db.simVenture.deleteMany({ where: { economyId } }),
    ...teams.map((t) => db.simVenture.create({ data: { economyId, teamId: t.id, roleKey: "", state: JSON.stringify({ cash: cfg.startCash }) } })),
    db.simAuctionLot.createMany({ data: lots.map((l, i) => ({ economyId, order: i, ...l })) }),
    db.simEconomy.update({ where: { id: economyId }, data: { status: "AUCTION" } }),
    db.simMessage.create({ data: { economyId, kind: "SYSTEM", body: `The setup auction is about to begin. Every company starts with a budget of ₹${cfg.startCash.toLocaleString("en-IN")}. Win one business identity and bid for resources that give you an edge.` } }),
  ]);
}

/** Settles lots whose bidding window has closed (called lazily from page loads and polls). */
export async function settleExpiredLots(economyId: string) {
  const expired = await db.simAuctionLot.findMany({ where: { economyId, status: "OPEN", endsAt: { lte: new Date() } } });
  for (const lot of expired) await closeLot(lot.id);
}

export async function openLot(lotId: string) {
  const lot = await db.simAuctionLot.findUniqueOrThrow({ where: { id: lotId }, include: { economy: true } });
  if (lot.economy.status !== "AUCTION") throw new Error("The auction is not running.");
  await settleExpiredLots(lot.economyId);
  if (await db.simAuctionLot.count({ where: { economyId: lot.economyId, status: "OPEN" } })) throw new Error("Close the open lot first.");
  if (lot.status !== "PENDING" && lot.status !== "UNSOLD") throw new Error("This lot has already been sold.");
  const cfg = parseConfig(lot.economy.config);
  await db.simAuctionLot.update({ where: { id: lotId }, data: { status: "OPEN", endsAt: new Date(Date.now() + cfg.auction.lotSeconds * 1000), winnerId: null, price: null } });
}

/** Highest bid wins (earliest on a tie). No bids → unsold. Only one caller can close a lot. */
export async function closeLot(lotId: string) {
  const claimed = await db.simAuctionLot.updateMany({ where: { id: lotId, status: "OPEN" }, data: { status: "CLOSING" } });
  if (!claimed.count) return;
  const lot = await db.simAuctionLot.findUniqueOrThrow({ where: { id: lotId } });
  const top = await db.simBid.findFirst({ where: { lotId }, orderBy: [{ amount: "desc" }, { createdAt: "asc" }] });
  if (!top) {
    await db.simAuctionLot.update({ where: { id: lotId }, data: { status: "UNSOLD", endsAt: null } });
    return;
  }
  const winner = await db.simVenture.findUniqueOrThrow({ where: { id: top.ventureId }, include: { team: true } });
  await db.$transaction([
    db.simAuctionLot.update({ where: { id: lotId }, data: { status: "SOLD", winnerId: top.ventureId, price: top.amount, endsAt: null } }),
    db.simVenture.update({ where: { id: winner.id }, data: { state: JSON.stringify({ cash: auctionWallet(winner.state) - top.amount }) } }),
    db.simMessage.create({ data: { economyId: lot.economyId, kind: "SYSTEM", body: `Sold: ${lot.name} to ${winner.team.name} for ₹${top.amount.toLocaleString("en-IN")}.` } }),
  ]);
}

/** A team bids on the open lot. Bids come out of the remaining budget, which must still cover an identity if the team has none. */
export async function placeBid(economyId: string, lotId: string, ventureId: string, amount: number, userId: string) {
  const econ = await db.simEconomy.findUniqueOrThrow({ where: { id: economyId } });
  if (econ.status !== "AUCTION") throw new Error("The auction is not running.");
  const cfg = parseConfig(econ.config);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a bid amount.");
  await db.$transaction(async (tx) => {
    const lot = await tx.simAuctionLot.findUnique({ where: { id: lotId } });
    if (!lot || lot.economyId !== economyId || lot.status !== "OPEN" || !lot.endsAt || lot.endsAt <= new Date()) throw new Error("Bidding on this lot has closed.");
    const venture = await tx.simVenture.findUniqueOrThrow({ where: { id: ventureId } });
    const won = await tx.simAuctionLot.findMany({ where: { economyId, winnerId: ventureId, status: "SOLD" } });
    const hasIdentity = won.some((l) => l.kind === "IDENTITY");
    if (lot.kind === "IDENTITY" && hasIdentity) throw new Error("You already own a business identity.");
    const top = await tx.simBid.findFirst({ where: { lotId }, orderBy: [{ amount: "desc" }, { createdAt: "asc" }] });
    if (top?.ventureId === ventureId) throw new Error("You already have the highest bid.");
    const minimum = top ? top.amount + cfg.auction.minIncrement : lot.reserve;
    if (amount < minimum) throw new Error(`The minimum bid is ₹${minimum.toLocaleString("en-IN")}.`);
    const cash = auctionWallet(venture.state);
    const keepForIdentity = lot.kind === "RESOURCE" && !hasIdentity ? cfg.auction.identityReserve : 0;
    if (amount > cash - keepForIdentity) throw new Error(`You can bid at most ₹${Math.max(0, cash - keepForIdentity).toLocaleString("en-IN")}${keepForIdentity ? " (you must keep enough to buy an identity)" : ""}.`);
    await tx.simBid.create({ data: { lotId, ventureId, amount: Math.round(amount), userId } });
    // Soft close: a late bid keeps the lot open a little longer.
    const extendTo = new Date(Date.now() + cfg.auction.extendSeconds * 1000);
    if (lot.endsAt < extendTo) await tx.simAuctionLot.update({ where: { id: lotId }, data: { endsAt: extendTo } });
  });
}

/**
 * Ends the auction: teams without an identity get a leftover one at the reserve price (or share a role if none
 * are left); each company then starts with its remaining budget, its identity and the perks of its resources.
 */
export async function finishAuction(economyId: string) {
  const econ = await db.simEconomy.findUniqueOrThrow({ where: { id: economyId }, include: { lots: true } });
  if (econ.status !== "AUCTION") throw new Error("The auction is not running.");
  for (const l of econ.lots.filter((x) => x.status === "OPEN")) await closeLot(l.id);
  const cfg = parseConfig(econ.config);
  const lots = await db.simAuctionLot.findMany({ where: { economyId } });
  const ventures = await db.simVenture.findMany({ where: { economyId }, include: { team: true } });
  const leftover = shuffle(lots.filter((l) => l.kind === "IDENTITY" && l.status !== "SOLD"), econ.id + "identities");
  const roleCount: Record<string, number> = {};
  for (const l of lots) if (l.kind === "IDENTITY" && l.status === "SOLD") roleCount[l.key] = (roleCount[l.key] ?? 0) + 1;
  const notes: string[] = [];
  const updates = shuffle(ventures, econ.id + "order").map((v) => {
    const won = lots.filter((l) => l.status === "SOLD" && l.winnerId === v.id);
    let cash = auctionWallet(v.state);
    let roleKey = won.find((l) => l.kind === "IDENTITY")?.key;
    if (!roleKey) {
      const lot = leftover.shift();
      roleKey = lot?.key ?? [...cfg.roles].sort((a, b) => (roleCount[a.key] ?? 0) - (roleCount[b.key] ?? 0))[0].key;
      cash -= cfg.auction.identityReserve;
      notes.push(`${v.team.name} was assigned ${roleOf(cfg, roleKey)?.name} at the reserve price.`);
    }
    roleCount[roleKey] = (roleCount[roleKey] ?? 0) + 1;
    const resources = won.filter((l) => l.kind === "RESOURCE").flatMap((l) => cfg.auction.resources.filter((r) => r.key === l.key));
    const perks: Perks = mergePerks(resources.map((r) => r.perks));
    const role = roleOf(cfg, roleKey)!;
    return db.simVenture.update({ where: { id: v.id }, data: { roleKey, state: JSON.stringify(initialState(cfg, role, { cash, perks, assets: resources.map((r) => r.name) })) } });
  });
  await db.$transaction([
    ...updates,
    db.simEconomy.update({ where: { id: economyId }, data: { status: "READY" } }),
    db.simMessage.create({ data: { economyId, kind: "SYSTEM", body: `The auction is over. ${notes.join(" ")} Name your company and get ready for year 1.`.replace(/\s+/g, " ") } }),
  ]);
}

// ---------------- Running the years ----------------

export async function startSimulation(economyId: string) {
  const econ = await db.simEconomy.findUniqueOrThrow({ where: { id: economyId }, include: { ventures: true } });
  if (econ.status !== "READY") throw new Error(econ.status === "SETUP" ? "Run the auction or auto-assign identities first." : "The simulation has already started.");
  const cfg = parseConfig(econ.config);
  if (econ.ventures.length < 2) throw new Error("At least two companies are needed.");
  if (econ.ventures.some((v) => !roleOf(cfg, v.roleKey))) throw new Error("Every company needs an identity.");
  await db.$transaction([
    db.simEconomy.update({
      where: { id: economyId },
      data: { status: "OPEN", currentCycle: 1, cycleEndsAt: new Date(Date.now() + cfg.cycleMinutes * 60_000), pausedMs: null, market: JSON.stringify(initialMarket(cfg)) },
    }),
    db.simMessage.create({ data: { economyId, kind: "SYSTEM", body: `The ${cfg.industry} economy is open. ${cfg.cycleNames[0] ?? "Year 1"} has started: submit your decisions before the window closes.` } }),
  ]);
}

function engineContract(c: { id: string; kind: string; sellerId: string; buyerId: string; units: number; unitPrice: number; ratePct: number; startCycle: number; cycles: number }): EngineContract {
  return { id: c.id, kind: c.kind as DealKind, sellerId: c.sellerId, buyerId: c.buyerId, units: c.units, unitPrice: c.unitPrice, ratePct: c.ratePct, startCycle: c.startCycle, cycles: c.cycles };
}

/**
 * Processes the open year: runs the engine on every team's decision at once, stores the results,
 * and opens the next year (or finishes the game and writes final marks).
 * Only one caller can claim a year, so concurrent page loads cannot double-process.
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
    const engineVentures = ventures.flatMap((v) => {
      const role = roleOf(cfg, v.roleKey);
      return role ? [{ id: v.id, roleKey: v.roleKey, state: ventureState(v.state) ?? initialState(cfg, role) }] : [];
    });
    const out = processCycle({
      cfg,
      cycle,
      market: marketState(econ.market, cfg),
      ventures: engineVentures,
      decisions: Object.fromEntries(decisions.map((d) => [d.ventureId, parseJson<Decision>(d.data, {} as Decision)])),
      contracts: running.map(engineContract),
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
        data: { economyId, kind: "SYSTEM", body: last ? `Year ${cycle} processed. The simulation is over: final results and awards are in.` : `Year ${cycle} processed. ${cfg.cycleNames[cycle] ?? `Year ${cycle + 1}`} is open.` },
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

/** Final metrics, marks and awards for every company. */
export async function finalStandings(economyId: string) {
  const econ = await db.simEconomy.findUniqueOrThrow({ where: { id: economyId }, include: { ventures: { include: { team: true } } } });
  const cfg = parseConfig(econ.config);
  const market = marketState(econ.market, cfg);
  const ventures = econ.ventures.flatMap((v) => {
    const st = ventureState(v.state);
    return st && roleOf(cfg, v.roleKey) ? [{ id: v.id, roleKey: v.roleKey, state: st, teamName: v.team.name, teamId: v.teamId, createdAt: v.createdAt }] : [];
  });
  const metrics = finalMetrics(cfg, ventures, market.priceLevel);
  const scores = scoreVentures(cfg, metrics);
  return { cfg, econ, ventures, metrics, scores, awards: computeAwards(metrics) };
}

/** Marks go into the round's Attempt rows so the shared leaderboard, cut-offs and analytics pick them up. */
export async function writeFinalScores(economyId: string) {
  const { econ, ventures, metrics, scores } = await finalStandings(economyId);
  const now = new Date();
  await db.$transaction(
    ventures.flatMap((v) => {
      const s = scores.find((x) => x.id === v.id);
      const m = metrics.find((x) => x.ventureId === v.id);
      if (!s || !m) return [];
      const answers = JSON.stringify({ ...m, composite: s.composite });
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

/** Lazy auto-advance: page loads after the deadline process the year (when the organisers enabled it), and close expired auction lots. */
export async function maybeAdvance(economyId: string) {
  const econ = await db.simEconomy.findUnique({ where: { id: economyId }, select: { config: true, status: true, cycleEndsAt: true } });
  if (!econ) return;
  if (econ.status === "AUCTION") return settleExpiredLots(economyId);
  if (econ.status !== "OPEN" || !econ.cycleEndsAt || econ.cycleEndsAt > new Date()) return;
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
  const I = (n: number, k: string) => Math.round(Math.min(100, fuzz(n, seed + k)));
  if (!r || !st) return `Research on ${target.team.name}: no trading history yet. Cash ${L(st?.cash ?? 0, "c")}, capacity ${st?.capacity ?? "—"} units${st?.assets.length ? `, owns ${st.assets.join(", ")}` : ""}.`;
  return [
    `Research on ${target.team.name} (estimates, ±8%), based on year ${r.cycle}:`,
    `Revenue ${L(r.revenue, "r")} · Net profit ${L(r.profit, "p")} · Cash ${L(r.cash, "c")} · Bank debt ${L(r.debt, "d")}`,
    `Capacity ${Math.round(fuzz(r.capacity, seed + "cap"))} units (+${st.pendingCapacity} coming) · Produced ${Math.round(fuzz(r.produced, seed + "q"))} · Inventory ${Math.round(r.inventory)}`,
    `Spending: marketing ${L(r.levers.marketing, "m")}, technology ${L(r.levers.technology, "t")}, employees ${L(r.levers.employees, "e")}`,
    `Technology ${I(r.tech, "ti")} · Customer satisfaction ${I(r.customerSat, "ci")} · Employee satisfaction ${I(r.employeeSat, "ei")} · Contract reliability ${Math.round(r.reliability * 100)}%`,
    st.assets.length ? `Owns: ${st.assets.join(", ")}` : "Owns no auctioned resources.",
  ].join("\n");
}
