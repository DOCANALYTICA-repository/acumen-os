"use server";

import { revalidatePath } from "next/cache";
import { db, audit } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { initialMarket, initialState } from "@/lib/sim/engine";
import { parseConfig, roleOf, TEMPLATES, type EconomyConfig, type EventEffects } from "@/lib/sim/model";
import { autoAssign, closeLot, createEconomy, finishAuction, marketState, openLot, prepareAuction, processOpenCycle, startSimulation, ventureState, writeFinalScores } from "@/lib/sim/service";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string, fallback = 0) => {
  const raw = String(fd.get(k) ?? "").replace(/,/g, "").trim();
  const v = Number(raw);
  return raw !== "" && Number.isFinite(v) ? v : fallback;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

async function econFor(fd: FormData) {
  const econ = await db.simEconomy.findUniqueOrThrow({ where: { id: s(fd, "economyId") } });
  return { econ, cfg: parseConfig(econ.config) };
}

function refresh(roundId: string) {
  revalidatePath(`/admin/simulation/${roundId}`);
  revalidatePath(`/rounds/${roundId}`);
  revalidatePath("/admin/results");
}

const beforeStart = (status: string) => status === "SETUP" || status === "READY";
function requireSetup(status: string) {
  if (!beforeStart(status)) throw new Error("This can only be changed before the simulation starts. Reset the simulation first if you must.");
}

/** Basic structural checks so a bad JSON edit cannot break the engine mid-event. */
function validateConfig(cfg: EconomyConfig) {
  if (!cfg.roles?.length) throw new Error("Add at least one identity (role).");
  const keys = new Set<string>();
  for (const r of cfg.roles) {
    if (!r.key || keys.has(r.key)) throw new Error(`Role keys must be unique and non-empty (problem: "${r.key}").`);
    keys.add(r.key);
    for (const f of ["basePrice", "unitCost", "fixedCost", "startCapacity", "capexPerUnit", "refDemand", "elasticity"] as const)
      if (!(Number(r[f]) >= 0)) throw new Error(`${r.name || r.key}: ${f} must be a non-negative number.`);
    if (!(r.basePrice > 0) || !(r.elasticity > 0)) throw new Error(`${r.name || r.key}: basePrice and elasticity must be above zero.`);
  }
  for (const r of cfg.roles) {
    for (const i of r.inputs ?? []) if (!keys.has(i.role)) throw new Error(`${r.name}: input role "${i.role}" does not exist.`);
    for (const d of r.drivers ?? []) if (!keys.has(d.role)) throw new Error(`${r.name}: driver role "${d.role}" does not exist.`);
  }
  if (!(cfg.cycles >= 1 && cfg.cycles <= 12)) throw new Error("Years must be between 1 and 12.");
  if (!(cfg.incumbentShare >= 0 && cfg.incumbentShare <= 0.8)) throw new Error("Incumbent share must be between 0 and 0.8.");
  const rk = new Set<string>();
  for (const r of cfg.auction.resources ?? []) {
    if (!r.key || rk.has(r.key)) throw new Error(`Auction resource keys must be unique (problem: "${r.key}").`);
    rk.add(r.key);
  }
}

export async function simCreate(fd: FormData) {
  const admin = await requireAdmin();
  const roundId = s(fd, "roundId");
  const round = await db.round.findUniqueOrThrow({ where: { id: roundId }, include: { economy: true } });
  if (round.type !== "SIMULATION") throw new Error("Not a simulation round.");
  if (!round.economy) await createEconomy(roundId, s(fd, "template") || "ev-mobility");
  await audit(admin.id, "sim.create", round.name);
  refresh(roundId);
}

export async function simLoadTemplate(fd: FormData) {
  const admin = await requireAdmin();
  const { econ } = await econFor(fd);
  requireSetup(econ.status);
  const key = s(fd, "template");
  const t = TEMPLATES[key];
  if (!t) throw new Error("Unknown template.");
  await db.$transaction([
    db.simEvent.deleteMany({ where: { economyId: econ.id } }),
    db.simEvent.createMany({ data: t.config.scheduledEvents.map((e) => ({ economyId: econ.id, cycle: e.cycle, title: e.title, description: e.description, effects: JSON.stringify(e.effects) })) }),
    db.simAuctionLot.deleteMany({ where: { economyId: econ.id } }),
    db.simVenture.deleteMany({ where: { economyId: econ.id } }),
    db.simEconomy.update({ where: { id: econ.id }, data: { template: key, status: "SETUP", config: JSON.stringify(t.config), market: JSON.stringify(initialMarket(t.config)) } }),
  ]);
  await audit(admin.id, "sim.template", key);
  refresh(econ.roundId);
}

export async function simSaveBasics(fd: FormData) {
  const admin = await requireAdmin();
  const { econ, cfg } = await econFor(fd);
  const next: EconomyConfig = { ...cfg, cycleMinutes: clamp(n(fd, "cycleMinutes", cfg.cycleMinutes), 1, 180), autoAdvance: fd.get("autoAdvance") === "on" };
  if (econ.status === "SETUP") {
    Object.assign(next, {
      industry: s(fd, "industry") || cfg.industry,
      tagline: s(fd, "tagline") || cfg.tagline,
      cycles: Math.round(clamp(n(fd, "cycles", cfg.cycles), 1, 12)),
      startCash: Math.max(0, n(fd, "startCash", cfg.startCash)),
      creditLimit: Math.max(0, n(fd, "creditLimit", cfg.creditLimit)),
      interestRate: clamp(n(fd, "interestRate", cfg.interestRate), 0, 40),
      taxRate: clamp(n(fd, "taxRate", cfg.taxRate), 0, 60),
      inflation: clamp(n(fd, "inflation", cfg.inflation), -5, 40),
      gdpGrowth: clamp(n(fd, "gdpGrowth", cfg.gdpGrowth), -15, 20),
      incumbentShare: clamp(n(fd, "incumbentShare", cfg.incumbentShare * 100) / 100, 0, 0.8),
      researchCost: Math.max(0, n(fd, "researchCost", cfg.researchCost)),
      contractPenaltyPct: clamp(n(fd, "contractPenaltyPct", cfg.contractPenaltyPct), 0, 100),
      cycleNames: s(fd, "cycleNames") ? s(fd, "cycleNames").split("\n").map((x) => x.trim()).filter(Boolean) : cfg.cycleNames,
      auction: {
        ...cfg.auction,
        enabled: fd.get("auctionEnabled") === "on",
        identityReserve: Math.max(0, n(fd, "identityReserve", cfg.auction.identityReserve)),
        minIncrement: Math.max(1, n(fd, "minIncrement", cfg.auction.minIncrement)),
        lotSeconds: clamp(n(fd, "lotSeconds", cfg.auction.lotSeconds), 10, 600),
        extendSeconds: clamp(n(fd, "extendSeconds", cfg.auction.extendSeconds), 0, 120),
      },
    });
  }
  next.scoring = {
    ...cfg.scoring,
    floor: clamp(n(fd, "floor", cfg.scoring.floor), 0, 100),
    profit: Math.max(0, n(fd, "wProfit", cfg.scoring.profit)),
    revenue: Math.max(0, n(fd, "wRevenue", cfg.scoring.revenue)),
    marketShare: Math.max(0, n(fd, "wShare", cfg.scoring.marketShare)),
    satisfaction: Math.max(0, n(fd, "wSatisfaction", cfg.scoring.satisfaction)),
    brand: Math.max(0, n(fd, "wBrand", cfg.scoring.brand)),
    reliability: Math.max(0, n(fd, "wReliability", cfg.scoring.reliability)),
    maxMarks: Math.max(1, n(fd, "maxMarks", cfg.scoring.maxMarks)),
  };
  validateConfig(next);
  // A new window length applies from the next year; the current deadline is kept.
  await db.simEconomy.update({ where: { id: econ.id }, data: { config: JSON.stringify(next), ...(econ.status === "SETUP" ? { market: JSON.stringify(initialMarket(next)) } : {}) } });
  await audit(admin.id, "sim.config", econ.id);
  refresh(econ.roundId);
}

export async function simSaveJson(fd: FormData) {
  const admin = await requireAdmin();
  const { econ } = await econFor(fd);
  if (econ.status !== "SETUP") throw new Error("The full configuration can only be edited before identities are handed out. Reset the simulation first.");
  let parsed: EconomyConfig;
  try {
    parsed = parseConfig(JSON.stringify(JSON.parse(s(fd, "config"))));
  } catch {
    throw new Error("That is not valid JSON.");
  }
  validateConfig(parsed);
  await db.simEconomy.update({ where: { id: econ.id }, data: { config: JSON.stringify(parsed), market: JSON.stringify(initialMarket(parsed)) } });
  await audit(admin.id, "sim.config_json", econ.id);
  refresh(econ.roundId);
}

// ---------------- Identities: auction or direct assignment ----------------

export async function simAutoAssign(fd: FormData) {
  const admin = await requireAdmin();
  const { econ } = await econFor(fd);
  const count = await autoAssign(econ.id);
  await audit(admin.id, "sim.auto_assign", `${count} teams`);
  refresh(econ.roundId);
}

export async function simSetRole(fd: FormData) {
  const admin = await requireAdmin();
  const { econ, cfg } = await econFor(fd);
  requireSetup(econ.status);
  const teamId = s(fd, "teamId");
  const roleKey = s(fd, "roleKey");
  if (!roleKey) await db.simVenture.deleteMany({ where: { economyId: econ.id, teamId } });
  else {
    const role = roleOf(cfg, roleKey);
    if (!role) throw new Error("Unknown identity.");
    const existing = await db.simVenture.findUnique({ where: { economyId_teamId: { economyId: econ.id, teamId } } });
    const prev = existing ? ventureState(existing.state) : null;
    // Keep what the team won at auction (cash, resources, name); only the identity changes.
    const state = JSON.stringify(initialState(cfg, role, prev ? { cash: prev.cash, perks: prev.perks, assets: prev.assets, companyName: prev.companyName } : {}));
    await db.simVenture.upsert({ where: { economyId_teamId: { economyId: econ.id, teamId } }, create: { economyId: econ.id, teamId, roleKey, state }, update: { roleKey, state } });
  }
  await db.simEconomy.update({ where: { id: econ.id }, data: { status: "READY" } });
  await audit(admin.id, "sim.set_role", `${teamId}:${roleKey || "none"}`);
  refresh(econ.roundId);
}

export async function simPrepareAuction(fd: FormData) {
  const admin = await requireAdmin();
  const { econ } = await econFor(fd);
  await prepareAuction(econ.id);
  await audit(admin.id, "sim.auction_prepare", econ.id);
  refresh(econ.roundId);
}

export async function simOpenLot(fd: FormData) {
  const admin = await requireAdmin();
  const lotId = s(fd, "lotId");
  await openLot(lotId);
  const lot = await db.simAuctionLot.findUniqueOrThrow({ where: { id: lotId }, include: { economy: true } });
  await db.simMessage.create({ data: { economyId: lot.economyId, kind: "SYSTEM", body: `Now bidding: ${lot.name}. Reserve ₹${lot.reserve.toLocaleString("en-IN")}.` } });
  await audit(admin.id, "sim.lot_open", lot.name);
  refresh(lot.economy.roundId);
}

export async function simCloseLot(fd: FormData) {
  const admin = await requireAdmin();
  const lot = await db.simAuctionLot.findUniqueOrThrow({ where: { id: s(fd, "lotId") }, include: { economy: true } });
  await closeLot(lot.id);
  await audit(admin.id, "sim.lot_close", lot.name);
  refresh(lot.economy.roundId);
}

export async function simFinishAuction(fd: FormData) {
  const admin = await requireAdmin();
  const { econ } = await econFor(fd);
  await finishAuction(econ.id);
  await audit(admin.id, "sim.auction_finish", econ.id);
  refresh(econ.roundId);
}

// ---------------- Running the years ----------------

export async function simStart(fd: FormData) {
  const admin = await requireAdmin();
  const { econ } = await econFor(fd);
  await startSimulation(econ.id);
  await audit(admin.id, "sim.start", econ.id);
  refresh(econ.roundId);
}

export async function simProcess(fd: FormData) {
  const admin = await requireAdmin();
  const { econ } = await econFor(fd);
  const ok = await processOpenCycle(econ.id);
  if (!ok) throw new Error("The year could not be processed: it is not open, or someone else is already processing it.");
  await audit(admin.id, "sim.process", `${econ.id}:y${econ.currentCycle}`);
  refresh(econ.roundId);
}

export async function simPause(fd: FormData) {
  const admin = await requireAdmin();
  const { econ } = await econFor(fd);
  if (econ.status !== "OPEN") throw new Error("Only an open year can be paused.");
  const pausedMs = econ.cycleEndsAt ? Math.max(0, econ.cycleEndsAt.getTime() - Date.now()) : 0;
  await db.simEconomy.updateMany({ where: { id: econ.id, status: "OPEN" }, data: { status: "PAUSED", pausedMs, cycleEndsAt: null } });
  await db.simMessage.create({ data: { economyId: econ.id, kind: "SYSTEM", body: "The organisers paused the simulation. The clock is stopped." } });
  await audit(admin.id, "sim.pause", econ.id);
  refresh(econ.roundId);
}

export async function simResume(fd: FormData) {
  const admin = await requireAdmin();
  const { econ, cfg } = await econFor(fd);
  if (econ.status !== "PAUSED") throw new Error("The simulation is not paused.");
  const ms = Math.max(60_000, econ.pausedMs ?? cfg.cycleMinutes * 60_000);
  await db.simEconomy.updateMany({ where: { id: econ.id, status: "PAUSED" }, data: { status: "OPEN", cycleEndsAt: new Date(Date.now() + ms), pausedMs: null } });
  await db.simMessage.create({ data: { economyId: econ.id, kind: "SYSTEM", body: "The simulation has resumed." } });
  await audit(admin.id, "sim.resume", econ.id);
  refresh(econ.roundId);
}

export async function simExtend(fd: FormData) {
  const admin = await requireAdmin();
  const { econ } = await econFor(fd);
  const minutes = n(fd, "minutes", 0);
  if (!minutes) throw new Error("Enter minutes to add (negative to shorten).");
  if (econ.status === "OPEN" && econ.cycleEndsAt)
    await db.simEconomy.update({ where: { id: econ.id }, data: { cycleEndsAt: new Date(Math.max(Date.now() + 10_000, econ.cycleEndsAt.getTime() + minutes * 60_000)) } });
  else if (econ.status === "PAUSED") await db.simEconomy.update({ where: { id: econ.id }, data: { pausedMs: Math.max(60_000, (econ.pausedMs ?? 0) + minutes * 60_000) } });
  else throw new Error("No decision window is running.");
  await audit(admin.id, "sim.extend", `${minutes} min`);
  refresh(econ.roundId);
}

/** Organisers move the economy's base parameters directly (applies from the year being decided). */
export async function simSetEconomy(fd: FormData) {
  const admin = await requireAdmin();
  const { econ, cfg } = await econFor(fd);
  if (econ.status === "PROCESSING" || econ.status === "FINISHED") throw new Error("The economy cannot be changed now.");
  const m = marketState(econ.market, cfg);
  const next = {
    ...m,
    interestRate: clamp(n(fd, "interestRate", m.interestRate), 0, 40),
    taxRate: clamp(n(fd, "taxRate", m.taxRate), 0, 60),
    inflation: clamp(n(fd, "inflation", m.inflation), -5, 40),
    gdpGrowth: clamp(n(fd, "gdpGrowth", m.gdpGrowth), -15, 20),
  };
  const labels = { interestRate: "Interest rate", taxRate: "Corporate tax", inflation: "Inflation", gdpGrowth: "GDP growth" } as const;
  const changes = (["interestRate", "taxRate", "inflation", "gdpGrowth"] as const).filter((k) => next[k] !== m[k]).map((k) => `${labels[k]} ${m[k]}% → ${next[k]}%`);
  if (!changes.length) throw new Error("Nothing changed.");
  await db.simEconomy.update({ where: { id: econ.id }, data: { market: JSON.stringify(next) } });
  const note = s(fd, "note");
  await db.simMessage.create({ data: { economyId: econ.id, kind: "SYSTEM", body: `Economy update: ${changes.join(", ")}.${note ? ` ${note}` : ""}` } });
  await audit(admin.id, "sim.economy", changes.join("; "));
  refresh(econ.roundId);
}

/** Back to the start: removes identities, auction, decisions, deals, messages, results and the round's marks. */
export async function simReset(fd: FormData) {
  const admin = await requireAdmin();
  const { econ, cfg } = await econFor(fd);
  if (econ.status === "PROCESSING") throw new Error("Wait for the current year to finish processing.");
  await db.$transaction([
    db.simDecision.deleteMany({ where: { economyId: econ.id } }),
    db.simContract.deleteMany({ where: { economyId: econ.id } }),
    db.simMessage.deleteMany({ where: { economyId: econ.id } }),
    db.simSnapshot.deleteMany({ where: { economyId: econ.id } }),
    db.simAuctionLot.deleteMany({ where: { economyId: econ.id } }),
    db.simVenture.deleteMany({ where: { economyId: econ.id } }),
    db.attempt.deleteMany({ where: { roundId: econ.roundId } }),
    db.simEconomy.update({ where: { id: econ.id }, data: { status: "SETUP", currentCycle: 0, cycleEndsAt: null, pausedMs: null, market: JSON.stringify(initialMarket(cfg)) } }),
  ]);
  await audit(admin.id, "sim.reset", econ.id);
  refresh(econ.roundId);
}

export async function simAddEvent(fd: FormData) {
  const admin = await requireAdmin();
  const { econ, cfg } = await econFor(fd);
  const cycle = Math.round(n(fd, "cycle", Math.max(1, econ.currentCycle)));
  const minCycle = econ.currentCycle > 0 ? econ.currentCycle : 1;
  if (econ.status === "FINISHED" || econ.status === "PROCESSING" || cycle < minCycle || cycle > cfg.cycles) throw new Error(`Pick a year from ${minCycle} to ${cfg.cycles}.`);
  const preset = cfg.eventLibrary.find((e) => e.key === s(fd, "preset"));
  let effects: EventEffects = preset?.effects ?? {};
  if (!preset) {
    try {
      effects = JSON.parse(s(fd, "effects") || "{}");
    } catch {
      throw new Error('Effects must be valid JSON, e.g. {"demand": {"fleet": 1.2}, "taxDelta": 3}');
    }
  }
  const title = s(fd, "title") || preset?.title;
  if (!title) throw new Error("Give the event a headline or pick a preset.");
  const description = s(fd, "description") || preset?.description || "";
  await db.simEvent.create({ data: { economyId: econ.id, cycle, title, description, effects: JSON.stringify(effects) } });
  if ((econ.status === "OPEN" || econ.status === "PAUSED") && cycle === econ.currentCycle)
    await db.simMessage.create({ data: { economyId: econ.id, kind: "SYSTEM", body: `Breaking: ${title}. ${description}` } });
  await audit(admin.id, "sim.event", `${title} @y${cycle}`);
  refresh(econ.roundId);
}

export async function simDeleteEvent(fd: FormData) {
  const admin = await requireAdmin();
  const ev = await db.simEvent.findUniqueOrThrow({ where: { id: s(fd, "eventId") }, include: { economy: true } });
  if (ev.economy.status === "FINISHED" || ev.economy.status === "PROCESSING" || (ev.economy.currentCycle > 0 && ev.cycle < ev.economy.currentCycle)) throw new Error("That event has already been applied.");
  await db.simEvent.delete({ where: { id: ev.id } });
  await audit(admin.id, "sim.event_delete", ev.title);
  refresh(ev.economy.roundId);
}

export async function simAdjustCash(fd: FormData) {
  const admin = await requireAdmin();
  const venture = await db.simVenture.findUniqueOrThrow({ where: { id: s(fd, "ventureId") }, include: { economy: true, team: true } });
  if (venture.economy.status === "PROCESSING") throw new Error("Wait for the year to finish processing.");
  const amount = n(fd, "amount", 0);
  const reason = s(fd, "reason");
  if (!amount || !reason) throw new Error("Enter an amount and a reason.");
  const st = ventureState(venture.state);
  const raw = JSON.parse(venture.state || "{}") as { cash?: number };
  const next = st ? { ...st, cash: Math.round((st.cash + amount) * 100) / 100 } : { ...raw, cash: Math.round(((raw.cash ?? 0) + amount) * 100) / 100 };
  await db.simVenture.update({ where: { id: venture.id }, data: { state: JSON.stringify(next) } });
  await db.simMessage.create({ data: { economyId: venture.economyId, toId: venture.id, kind: "SYSTEM", body: `Organiser adjustment: ${amount > 0 ? "+" : "−"}₹${Math.abs(amount).toLocaleString("en-IN")} cash. Reason: ${reason}` } });
  await audit(admin.id, "sim.adjust_cash", `${venture.team.name}: ${amount} (${reason})`);
  refresh(venture.economy.roundId);
}

export async function simBroadcast(fd: FormData) {
  const admin = await requireAdmin();
  const { econ } = await econFor(fd);
  const body = s(fd, "body").slice(0, 1000);
  if (!body) throw new Error("Write a message.");
  await db.simMessage.create({ data: { economyId: econ.id, kind: "SYSTEM", body } });
  await audit(admin.id, "sim.broadcast", body.slice(0, 80));
  refresh(econ.roundId);
}

export async function simRescore(fd: FormData) {
  const admin = await requireAdmin();
  const { econ } = await econFor(fd);
  if (econ.status !== "FINISHED") throw new Error("Final marks are written when the last year is processed.");
  await writeFinalScores(econ.id);
  await audit(admin.id, "sim.rescore", econ.id);
  refresh(econ.roundId);
}
