"use server";

import { revalidatePath } from "next/cache";
import { db, audit } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { getContent } from "@/lib/content";
import { entryBlocker, teamStatus } from "@/lib/rounds";
import { sanitizeDecision } from "@/lib/sim/engine";
import { inputNeed, parseConfig, roleOf, spotPrice } from "@/lib/sim/model";
import { maybeAdvance, researchReport, ventureState } from "@/lib/sim/service";
import type { FormState } from "./auth";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string) => {
  const v = Number(String(fd.get(k) ?? "").replace(/,/g, ""));
  return Number.isFinite(v) ? v : 0;
};

/** Caller's team, its startup in this round's economy, and whether it may act now. */
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
  if (!venture) throw new Error("Your team has not been given a startup in this economy yet.");
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

export async function saveDecision(_: FormState, fd: FormData): Promise<FormState> {
  const roundId = s(fd, "roundId");
  return guard(async () => {
    const { user, econ, venture, cfg } = await simContext(roundId);
    if (econ.status !== "OPEN") throw new Error(econ.status === "PAUSED" ? "The simulation is paused. Decisions reopen when it resumes." : "The decision window is closed.");
    if (econ.cycleEndsAt && econ.cycleEndsAt < new Date()) throw new Error("Time is up for this cycle. Wait for the organisers to process it.");
    const role = roleOf(cfg, venture.roleKey)!;
    const state = ventureState(venture.state)!;
    const d = sanitizeDecision(cfg, role, state, {
      price: n(fd, "price"), production: n(fd, "production"), capacityInvest: n(fd, "capacityInvest"),
      marketing: n(fd, "marketing"), quality: n(fd, "quality"), borrow: n(fd, "borrow"), repay: n(fd, "repay"),
    });
    await db.simDecision.upsert({
      where: { ventureId_cycle: { ventureId: venture.id, cycle: econ.currentCycle } },
      create: { economyId: econ.id, ventureId: venture.id, cycle: econ.currentCycle, data: JSON.stringify(d), submittedById: user.id },
      update: { data: JSON.stringify(d), submittedById: user.id },
    });
    await audit(user.id, "sim.decision", `${venture.id}:c${econ.currentCycle}`);
    return done(roundId, `Decision saved for cycle ${econ.currentCycle}. You can change it until the window closes.`);
  });
}

export async function proposeContract(_: FormState, fd: FormData): Promise<FormState> {
  const roundId = s(fd, "roundId");
  return guard(async () => {
    const { user, econ, venture, cfg } = await simContext(roundId);
    if (econ.status !== "OPEN" && econ.status !== "PAUSED") throw new Error("Contracts can only be proposed while the simulation is running.");
    const other = await db.simVenture.findFirst({ where: { id: s(fd, "counterpartyId"), economyId: econ.id } });
    if (!other || other.id === venture.id) throw new Error("Pick another startup.");
    const selling = s(fd, "direction") === "sell";
    const seller = selling ? venture : other;
    const buyer = selling ? other : venture;
    if (!inputNeed(cfg, seller.roleKey, buyer.roleKey))
      throw new Error(`${roleOf(cfg, buyer.roleKey)?.name} does not use ${roleOf(cfg, seller.roleKey)?.product}, so there is nothing to trade in that direction.`);
    const units = Math.round(n(fd, "units") * 10) / 10;
    const unitPrice = Math.round(n(fd, "unitPrice"));
    const remaining = cfg.cycles - econ.currentCycle + 1;
    const cycles = Math.round(n(fd, "cycles"));
    const spot = spotPrice(cfg, seller.roleKey);
    if (units <= 0 || units > 2000) throw new Error("Units per cycle must be between 0 and 2,000.");
    if (unitPrice <= 0 || unitPrice > spot * 3) throw new Error(`Unit price must be between ₹1 and ₹${Math.round(spot * 3).toLocaleString("en-IN")}.`);
    if (cycles < 1 || cycles > remaining) throw new Error(`Duration must be 1 to ${remaining} cycle${remaining === 1 ? "" : "s"}.`);
    const open = await db.simContract.count({ where: { economyId: econ.id, proposerId: venture.id, status: "PROPOSED" } });
    if (open >= 10) throw new Error("You have 10 open proposals. Withdraw some first.");
    await db.simContract.create({
      data: { economyId: econ.id, sellerId: seller.id, buyerId: buyer.id, proposerId: venture.id, units, unitPrice, cycles, startCycle: econ.currentCycle, note: s(fd, "note").slice(0, 300) },
    });
    await db.simMessage.create({
      data: { economyId: econ.id, fromId: venture.id, toId: other.id, kind: "SYSTEM", body: `Proposed a contract: ${selling ? "we sell you" : "you sell us"} ${units} ${roleOf(cfg, seller.roleKey)?.product} per cycle at ₹${unitPrice.toLocaleString("en-IN")} each for ${cycles} cycle${cycles === 1 ? "" : "s"}.` },
    });
    await audit(user.id, "sim.contract_propose", `${venture.id}->${other.id}`);
    return done(roundId, "Proposal sent. It becomes binding when the other team accepts.");
  });
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
    if (econ.status !== "OPEN" && econ.status !== "PAUSED") throw new Error("The simulation is not running.");
    const other = c.sellerId === venture.id ? c.buyerId : c.sellerId;
    if (action === "accept") {
      const remaining = cfg.cycles - econ.currentCycle + 1;
      // Atomic: only accept if still PROPOSED (the proposer may have withdrawn a moment ago).
      const res = await db.simContract.updateMany({
        where: { id: c.id, status: "PROPOSED" },
        data: { status: "ACTIVE", startCycle: econ.currentCycle, cycles: Math.min(c.cycles, remaining), respondedAt: new Date() },
      });
      if (res.count !== 1) throw new Error("This proposal is no longer open.");
      await db.simMessage.create({ data: { economyId: econ.id, fromId: venture.id, toId: other, kind: "SYSTEM", body: `Accepted your contract proposal. It applies from cycle ${econ.currentCycle}.` } });
      await audit(user.id, "sim.contract_accept", c.id);
      return done(roundId, `Contract signed. Deliveries start when cycle ${econ.currentCycle} is processed.`);
    }
    await db.simContract.updateMany({ where: { id: c.id, status: "PROPOSED" }, data: { status: "REJECTED", respondedAt: new Date() } });
    await db.simMessage.create({ data: { economyId: econ.id, fromId: venture.id, toId: other, kind: "SYSTEM", body: "Declined your contract proposal." } });
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
    if (econ.status !== "OPEN" && econ.status !== "PAUSED") throw new Error("Research is available while the simulation is running.");
    const targetId = s(fd, "targetId");
    if (targetId === venture.id || !(await db.simVenture.findFirst({ where: { id: targetId, economyId: econ.id } }))) throw new Error("Pick another startup.");
    const body = await researchReport(econ.id, venture.id, targetId, econ.currentCycle);
    // The charge is added to this cycle's costs; the engine deducts it when the cycle is processed.
    await db.$transaction(async (tx) => {
      const live = await tx.simEconomy.findUniqueOrThrow({ where: { id: econ.id }, select: { status: true } });
      if (live.status === "PROCESSING") throw new Error("The cycle is being processed. Try again in a moment.");
      const fresh = await tx.simVenture.findUniqueOrThrow({ where: { id: venture.id } });
      const st = ventureState(fresh.state)!;
      st.pendingCharges += cfg.researchCost;
      await tx.simVenture.update({ where: { id: venture.id }, data: { state: JSON.stringify(st) } });
      await tx.simMessage.create({ data: { economyId: econ.id, toId: venture.id, kind: "INTEL", body } });
    });
    await audit(user.id, "sim.research", `${venture.id}->${targetId}`);
    return done(roundId, `Report delivered to your inbox. ₹${cfg.researchCost.toLocaleString("en-IN")} will be charged this cycle.`);
  });
}
