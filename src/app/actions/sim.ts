"use server";

import { revalidatePath } from "next/cache";
import { db, audit } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { getContent } from "@/lib/content";
import { entryBlocker, teamStatus } from "@/lib/rounds";
import { sanitizeDecision } from "@/lib/sim/engine";
import { DEAL_KINDS, inputNeed, LEVERS, parseConfig, roleOf, spotPrice, type DealKind } from "@/lib/sim/model";
import { marketState, maybeAdvance, placeBid, researchReport, ventureState } from "@/lib/sim/service";
import type { FormState } from "./auth";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => {
  const v = Number(String(fd.get(k) ?? "").replace(/,/g, ""));
  return Number.isFinite(v) ? v : 0;
};
const rupees = (x: number) => `₹${Math.round(x).toLocaleString("en-IN")}`;

/** Caller's team, its company in this round's economy, and whether it may act now. */
async function simContext(roundId: string) {
  const user = await requireRole("PARTICIPANT");
  const team = user.membership?.team;
  if (!team) throw new Error("Join a team first.");
  const round = await db.round.findUnique({ where: { id: roundId }, include: { economy: true } });
  if (!round || round.type !== "SIMULATION" || !round.economy) throw new Error("Simulation not found.");
  const content = await getContent();
  const qualified = !!(await db.qualification.findUnique({ where: { roundId_teamId: { roundId, teamId: team.id } } }));
  const blocker = entryBlocker({ round, status: teamStatus(team, team.members.length, content.teamMin), qualified });
  if (blocker) throw new Error(blocker);
  await maybeAdvance(round.economy.id);
  const econ = await db.simEconomy.findUniqueOrThrow({ where: { id: round.economy.id } });
  const venture = await db.simVenture.findUnique({ where: { economyId_teamId: { economyId: econ.id, teamId: team.id } } });
  if (!venture) throw new Error("Your team has not been given a company in this economy yet.");
  return { user, team, round, econ, venture, cfg: parseConfig(econ.config) };
}

function done(roundId: string, ok: string): FormState {
  revalidatePath(`/rounds/${roundId}`);
  return { ok };
}

async function guard(fn: () => Promise<FormState>): Promise<FormState> {
  try {
    return await fn();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Something went wrong." };
  }
}

const running = (status: string) => status === "OPEN" || status === "PAUSED";

export async function saveDecision(_: FormState, fd: FormData): Promise<FormState> {
  const roundId = s(fd, "roundId");
  return guard(async () => {
    const { user, econ, venture, cfg } = await simContext(roundId);
    if (econ.status !== "OPEN") throw new Error(econ.status === "PAUSED" ? "The simulation is paused. Decisions reopen when it resumes." : "The decision window is closed.");
    if (econ.cycleEndsAt && econ.cycleEndsAt < new Date()) throw new Error("Time is up for this year. Wait for the organisers to process it.");
    const role = roleOf(cfg, venture.roleKey)!;
    const state = ventureState(venture.state)!;
    const pl = marketState(econ.market, cfg).priceLevel;
    const d = sanitizeDecision(cfg, role, state, {
      price: n(fd, "price"), production: n(fd, "production"), capacityInvest: n(fd, "capacityInvest"), borrow: n(fd, "borrow"), repay: n(fd, "repay"),
      ...Object.fromEntries(LEVERS.map((l) => [l.key, n(fd, l.key)])),
    }, pl);
    await db.simDecision.upsert({
      where: { ventureId_cycle: { ventureId: venture.id, cycle: econ.currentCycle } },
      create: { economyId: econ.id, ventureId: venture.id, cycle: econ.currentCycle, data: JSON.stringify(d), submittedById: user.id },
      update: { data: JSON.stringify(d), submittedById: user.id },
    });
    await audit(user.id, "sim.decision", `${venture.id}:y${econ.currentCycle}`);
    return done(roundId, `Decision saved for year ${econ.currentCycle}. You can change it until the window closes.`);
  });
}

/** Describes a deal from the proposer's side, for messages. */
function dealSummary(kind: DealKind, weProvide: boolean, d: { units: number; amount: number; ratePct: number; cycles: number }, product: string) {
  const yrs = `${d.cycles} year${d.cycles === 1 ? "" : "s"}`;
  switch (kind) {
    case "SUPPLY":
      return `${weProvide ? "we sell you" : "you sell us"} ${d.units} ${product} a year at ${rupees(d.amount)} each for ${yrs}`;
    case "LICENSE":
      return `${weProvide ? "we license our technology to you" : "you license your technology to us"} for ${rupees(d.amount)} a year for ${yrs}`;
    case "LOAN":
      return `${weProvide ? "we lend you" : "you lend us"} ${rupees(d.amount)} at ${d.ratePct}% a year, repaid over ${yrs}`;
    case "MARKETING":
      return `a co-marketing alliance where each of us puts ${rupees(d.amount)} a year into joint campaigns for ${yrs}`;
  }
}

export async function proposeContract(_: FormState, fd: FormData): Promise<FormState> {
  const roundId = s(fd, "roundId");
  return guard(async () => {
    const { user, econ, venture, cfg } = await simContext(roundId);
    if (!running(econ.status)) throw new Error("Deals can only be proposed while the simulation is running.");
    const kind = s(fd, "kind") as DealKind;
    if (!(kind in DEAL_KINDS)) throw new Error("Pick a deal type.");
    const other = await db.simVenture.findFirst({ where: { id: s(fd, "counterpartyId"), economyId: econ.id } });
    if (!other || other.id === venture.id) throw new Error("Pick another company.");
    const weProvide = s(fd, "direction") !== "receive";
    const provider = kind === "MARKETING" || weProvide ? venture : other;
    const receiver = provider.id === venture.id ? other : venture;
    const remaining = cfg.cycles - econ.currentCycle + 1;
    const cycles = Math.round(n(fd, "cycles"));
    if (cycles < 1 || cycles > remaining) throw new Error(`Duration must be 1 to ${remaining} year${remaining === 1 ? "" : "s"}.`);
    const pl = marketState(econ.market, cfg).priceLevel;
    let units = 0;
    const amount = Math.round(n(fd, "amount"));
    let ratePct = 0;
    if (kind === "SUPPLY") {
      if (!inputNeed(cfg, provider.roleKey, receiver.roleKey))
        throw new Error(`${roleOf(cfg, receiver.roleKey)?.name} does not use ${roleOf(cfg, provider.roleKey)?.product}, so there is nothing to supply in that direction.`);
      units = Math.round(n(fd, "units") * 10) / 10;
      const spot = spotPrice(cfg, provider.roleKey, 1, pl);
      if (units <= 0 || units > 2000) throw new Error("Units per year must be between 0 and 2,000.");
      if (amount <= 0 || amount > spot * 3) throw new Error(`Price per unit must be between ₹1 and ${rupees(spot * 3)}.`);
    } else if (kind === "LICENSE") {
      if (amount < 1000 || amount > 1_000_000) throw new Error("The yearly licence fee must be between ₹1,000 and ₹10,00,000.");
    } else if (kind === "LOAN") {
      ratePct = Math.round(n(fd, "ratePct") * 10) / 10;
      if (amount < 10_000 || amount > 1_500_000) throw new Error("Loan amount must be between ₹10,000 and ₹15,00,000.");
      if (ratePct < 0 || ratePct > 30) throw new Error("Interest must be between 0% and 30% a year.");
    } else if (amount < 5_000 || amount > 500_000) throw new Error("Each partner's yearly contribution must be between ₹5,000 and ₹5,00,000.");
    const open = await db.simContract.count({ where: { economyId: econ.id, proposerId: venture.id, status: "PROPOSED" } });
    if (open >= 10) throw new Error("You have 10 open proposals. Withdraw some first.");
    await db.simContract.create({
      data: {
        economyId: econ.id, kind, sellerId: provider.id, buyerId: receiver.id, proposerId: venture.id, units, unitPrice: amount, ratePct, cycles,
        startCycle: econ.currentCycle, note: s(fd, "note").slice(0, 300),
      },
    });
    const product = roleOf(cfg, provider.roleKey)?.product ?? "units";
    await db.simMessage.create({
      data: { economyId: econ.id, fromId: venture.id, toId: other.id, kind: "SYSTEM", body: `Proposed a ${DEAL_KINDS[kind].label.toLowerCase()}: ${dealSummary(kind, provider.id === venture.id, { units, amount, ratePct, cycles }, product)}.` },
    });
    await audit(user.id, "sim.deal_propose", `${kind}:${venture.id}->${other.id}`);
    return done(roundId, "Proposal sent. It becomes binding when the other team accepts.");
  });
}

/** ₹ value of a deal, credited to both sides' "deals signed" total. */
function dealValue(c: { kind: string; units: number; unitPrice: number; cycles: number }) {
  if (c.kind === "SUPPLY") return c.units * c.unitPrice * c.cycles;
  if (c.kind === "LOAN") return c.unitPrice;
  return c.unitPrice * c.cycles;
}

export async function respondContract(_: FormState, fd: FormData): Promise<FormState> {
  const roundId = s(fd, "roundId");
  return guard(async () => {
    const { user, econ, venture, cfg } = await simContext(roundId);
    const c = await db.simContract.findFirst({ where: { id: s(fd, "contractId"), economyId: econ.id } });
    if (!c || c.status !== "PROPOSED") throw new Error("This proposal is no longer open.");
    const action = s(fd, "action");
    if (action === "withdraw") {
      if (c.proposerId !== venture.id) throw new Error("Only the proposer can withdraw.");
      await db.simContract.updateMany({ where: { id: c.id, status: "PROPOSED" }, data: { status: "WITHDRAWN", respondedAt: new Date() } });
      return done(roundId, "Proposal withdrawn.");
    }
    if (c.proposerId === venture.id || (c.sellerId !== venture.id && c.buyerId !== venture.id)) throw new Error("Only the other party can respond.");
    if (!running(econ.status)) throw new Error("The simulation is not running.");
    const other = c.sellerId === venture.id ? c.buyerId : c.sellerId;
    if (action === "accept") {
      const remaining = cfg.cycles - econ.currentCycle + 1;
      const cycles = Math.min(c.cycles, remaining);
      await db.$transaction(async (tx) => {
        const live = await tx.simEconomy.findUniqueOrThrow({ where: { id: econ.id }, select: { status: true } });
        if (live.status === "PROCESSING") throw new Error("The year is being processed. Try again in a moment.");
        if (c.kind === "LOAN") {
          const lender = ventureState((await tx.simVenture.findUniqueOrThrow({ where: { id: c.sellerId } })).state);
          if (!lender || lender.cash < c.unitPrice) throw new Error("The lender does not have enough cash for this loan right now.");
        }
        // Atomic: only accept if still PROPOSED (the proposer may have withdrawn a moment ago).
        const res = await tx.simContract.updateMany({ where: { id: c.id, status: "PROPOSED" }, data: { status: "ACTIVE", startCycle: econ.currentCycle, cycles, respondedAt: new Date() } });
        if (res.count !== 1) throw new Error("This proposal is no longer open.");
        const value = dealValue({ ...c, cycles });
        for (const id of [c.sellerId, c.buyerId]) {
          const v = await tx.simVenture.findUniqueOrThrow({ where: { id } });
          const st = ventureState(v.state);
          if (st) await tx.simVenture.update({ where: { id }, data: { state: JSON.stringify({ ...st, dealValue: Math.round((st.dealValue ?? 0) + value) }) } });
        }
        await tx.simMessage.create({ data: { economyId: econ.id, fromId: venture.id, toId: other, kind: "SYSTEM", body: `Accepted your ${DEAL_KINDS[c.kind as DealKind]?.label.toLowerCase() ?? "deal"}. It applies from year ${econ.currentCycle}.` } });
      });
      await audit(user.id, "sim.deal_accept", c.id);
      return done(roundId, `Deal signed. It takes effect when year ${econ.currentCycle} is processed.`);
    }
    await db.simContract.updateMany({ where: { id: c.id, status: "PROPOSED" }, data: { status: "REJECTED", respondedAt: new Date() } });
    await db.simMessage.create({ data: { economyId: econ.id, fromId: venture.id, toId: other, kind: "SYSTEM", body: "Declined your deal proposal." } });
    return done(roundId, "Proposal declined.");
  });
}

export async function sendSimMessage(_: FormState, fd: FormData): Promise<FormState> {
  const roundId = s(fd, "roundId");
  return guard(async () => {
    const { econ, venture } = await simContext(roundId);
    const body = s(fd, "body").slice(0, 1000);
    if (!body) throw new Error("Write a message.");
    const toId = s(fd, "toId") || null;
    if (toId && !(await db.simVenture.findFirst({ where: { id: toId, economyId: econ.id } }))) throw new Error("Unknown recipient.");
    await db.simMessage.create({ data: { economyId: econ.id, fromId: venture.id, toId, body } });
    return done(roundId, "Sent.");
  });
}

export async function buyResearch(_: FormState, fd: FormData): Promise<FormState> {
  const roundId = s(fd, "roundId");
  return guard(async () => {
    const { user, econ, venture, cfg } = await simContext(roundId);
    if (!running(econ.status)) throw new Error("Research is available while the simulation is running.");
    const targetId = s(fd, "targetId");
    if (targetId === venture.id || !(await db.simVenture.findFirst({ where: { id: targetId, economyId: econ.id } }))) throw new Error("Pick another company.");
    const body = await researchReport(econ.id, venture.id, targetId, econ.currentCycle);
    // The charge is added to this year's costs; the engine deducts it when the year is processed.
    await db.$transaction(async (tx) => {
      const live = await tx.simEconomy.findUniqueOrThrow({ where: { id: econ.id }, select: { status: true } });
      if (live.status === "PROCESSING") throw new Error("The year is being processed. Try again in a moment.");
      const fresh = await tx.simVenture.findUniqueOrThrow({ where: { id: venture.id } });
      const st = ventureState(fresh.state)!;
      st.pendingCharges += cfg.researchCost;
      await tx.simVenture.update({ where: { id: venture.id }, data: { state: JSON.stringify(st) } });
      await tx.simMessage.create({ data: { economyId: econ.id, toId: venture.id, kind: "INTEL", body } });
    });
    await audit(user.id, "sim.research", `${venture.id}->${targetId}`);
    return done(roundId, `Report delivered to your inbox. ${rupees(cfg.researchCost)} will be charged this year.`);
  });
}

export async function bidOnLot(_: FormState, fd: FormData): Promise<FormState> {
  const roundId = s(fd, "roundId");
  return guard(async () => {
    const { user, econ, venture } = await simContext(roundId);
    await placeBid(econ.id, s(fd, "lotId"), venture.id, n(fd, "amount"), user.id);
    return done(roundId, `Bid of ${rupees(n(fd, "amount"))} placed.`);
  });
}

export async function setCompanyName(_: FormState, fd: FormData): Promise<FormState> {
  const roundId = s(fd, "roundId");
  return guard(async () => {
    const { user, econ, venture } = await simContext(roundId);
    if (econ.status === "FINISHED") throw new Error("The simulation is over.");
    const name = s(fd, "companyName").replace(/\s+/g, " ").slice(0, 40);
    if (name.length < 2) throw new Error("Company names need at least 2 characters.");
    await db.$transaction(async (tx) => {
      const live = await tx.simEconomy.findUniqueOrThrow({ where: { id: econ.id }, select: { status: true } });
      if (live.status === "PROCESSING") throw new Error("The year is being processed. Try again in a moment.");
      const fresh = await tx.simVenture.findUniqueOrThrow({ where: { id: venture.id } });
      const st = ventureState(fresh.state);
      if (!st) throw new Error("You can name your company once the auction is over.");
      await tx.simVenture.update({ where: { id: venture.id }, data: { state: JSON.stringify({ ...st, companyName: name }) } });
    });
    await audit(user.id, "sim.company_name", `${venture.id}:${name}`);
    return done(roundId, `Your company is now called ${name}.`);
  });
}
