"use server";

import { revalidatePath } from "next/cache";
import { db, audit } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { getContent, registrationOpen } from "@/lib/content";
import { saveUpload } from "@/lib/files";
import { TEAM_SIZE } from "@/lib/rounds";
import type { FormState } from "./auth";

const BLOCKED_WORDS = ["fuck", "shit", "bitch", "bastard", "asshole", "dick", "slut"];

function validTeamName(name: string): string | null {
  if (name.length < 3 || name.length > 30) return "Team name must be 3–30 characters.";
  if (!/^[\p{L}\p{N} .'&_-]+$/u.test(name)) return "Use letters, numbers, spaces and . ' & _ - only.";
  if (BLOCKED_WORDS.some((w) => name.toLowerCase().includes(w))) return "Please choose a different team name.";
  return null;
}

function newInviteCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

async function uniqueInviteCode() {
  for (;;) {
    const code = newInviteCode();
    if (!(await db.team.findUnique({ where: { inviteCode: code } }))) return code;
  }
}

async function rosterLocked() {
  return !registrationOpen(await getContent());
}

async function nameTaken(name: string, exceptTeamId?: string) {
  const all = await db.team.findMany({ select: { id: true, name: true } });
  return all.some((t) => t.id !== exceptTeamId && t.name.toLowerCase() === name.toLowerCase());
}

export async function checkTeamName(raw: string) {
  const name = raw.trim();
  const err = validTeamName(name);
  if (err) return { ok: false, message: err };
  if (await nameTaken(name)) return { ok: false, message: "That name is taken." };
  return { ok: true, message: "Available" };
}

export async function createTeam(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireRole("PARTICIPANT");
  if (user.membership) return { error: "You are already in a team." };
  if (await rosterLocked()) return { error: "Registrations are closed; teams can no longer be created." };
  const name = String(fd.get("name") ?? "").trim();
  const err = validTeamName(name);
  if (err) return { error: err };
  if (await nameTaken(name)) return { error: "That team name is taken." };

  const team = await db.team.create({
    data: { name, inviteCode: await uniqueInviteCode(), members: { create: { userId: user.id, isLead: true } } },
  });
  await audit(user.id, "team.create", team.name);
  revalidatePath("/dashboard");
  return { ok: "Team created." };
}

export async function joinTeam(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireRole("PARTICIPANT");
  if (user.membership) return { error: "You are already in a team." };
  if (await rosterLocked()) return { error: "Registrations are closed; rosters are locked." };
  const code = String(fd.get("code") ?? "").trim().toUpperCase();
  const team = await db.team.findUnique({ where: { inviteCode: code }, include: { members: true } });
  if (!team) return { error: "No team found with that invite code." };
  if (team.disqualified) return { error: "This team can no longer accept members." };
  if (team.members.length >= TEAM_SIZE) return { error: `This team is full (teams are ${TEAM_SIZE} people).` };

  await db.teamMember.create({ data: { teamId: team.id, userId: user.id } });
  await audit(user.id, "team.join", team.name);
  revalidatePath("/dashboard");
  return { ok: `You joined ${team.name}.` };
}

async function requireLead() {
  const user = await requireRole("PARTICIPANT");
  const m = user.membership;
  if (!m?.isLead) throw new Error("Only the team lead can do this.");
  return { user, team: m.team };
}

export async function leaveTeam() {
  const user = await requireRole("PARTICIPANT");
  const m = user.membership;
  if (!m) return;
  if (await rosterLocked()) throw new Error("Rosters are locked.");
  if (m.isLead) {
    if (m.team.members.length > 1) throw new Error("Transfer the lead role before leaving.");
    await db.team.delete({ where: { id: m.teamId } });
  } else {
    await db.teamMember.delete({ where: { id: m.id } });
  }
  await audit(user.id, "team.leave", m.team.name);
  revalidatePath("/dashboard");
}

export async function removeMember(fd: FormData) {
  const { user, team } = await requireLead();
  if (await rosterLocked()) throw new Error("Rosters are locked.");
  const memberId = String(fd.get("userId"));
  if (memberId === user.id) return;
  await db.teamMember.deleteMany({ where: { teamId: team.id, userId: memberId } });
  await audit(user.id, "team.remove_member", `${team.name}:${memberId}`);
  revalidatePath("/dashboard");
}

export async function transferLead(fd: FormData) {
  const { user, team } = await requireLead();
  const to = String(fd.get("userId"));
  if (!team.members.some((m) => m.userId === to)) return;
  await db.$transaction([
    db.teamMember.updateMany({ where: { teamId: team.id }, data: { isLead: false } }),
    db.teamMember.updateMany({ where: { teamId: team.id, userId: to }, data: { isLead: true } }),
  ]);
  await audit(user.id, "team.transfer_lead", `${team.name}:${to}`);
  revalidatePath("/dashboard");
}

export async function regenerateInvite() {
  const { user, team } = await requireLead();
  await db.team.update({ where: { id: team.id }, data: { inviteCode: await uniqueInviteCode() } });
  await audit(user.id, "team.regenerate_code", team.name);
  revalidatePath("/dashboard");
}

export async function renameTeam(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { user, team } = await requireLead();
    if (await rosterLocked()) return { error: "Rosters are locked." };
    const name = String(fd.get("name") ?? "").trim();
    const err = validTeamName(name);
    if (err) return { error: err };
    if (await nameTaken(name, team.id)) return { error: "That team name is taken." };
    await db.team.update({ where: { id: team.id }, data: { name } });
    await audit(user.id, "team.rename", `${team.name} -> ${name}`);
    revalidatePath("/dashboard");
    return { ok: "Team renamed." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const PAYMENT_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"];

export async function uploadPayment(_: FormState, fd: FormData): Promise<FormState> {
  let ctx;
  try {
    ctx = await requireLead();
  } catch (e) {
    return { error: (e as Error).message };
  }
  const { user, team } = ctx;
  const file = fd.get("screenshot");
  const txn = String(fd.get("transactionId") ?? "").trim();
  if (!(file instanceof File) || file.size === 0) return { error: "Attach the payment screenshot." };
  if (!PAYMENT_TYPES.includes(file.type)) return { error: "Upload a JPG, PNG, WEBP or PDF." };
  if (file.size > 5 * 1024 * 1024) return { error: "File must be 5 MB or smaller." };
  if (txn.length < 4 || txn.length > 64) return { error: "Enter the transaction / UTR ID from your payment." };

  const saved = await saveUpload(file, `teams/${team.id}/payment`);
  // Auto-accepted per PRD; admins can reject later. Duplicate transaction IDs are flagged in the admin panel.
  await db.team.update({
    where: { id: team.id },
    data: { paymentScreenshot: saved.path, transactionId: txn, paymentStatus: "PAID" },
  });
  await audit(user.id, "team.payment_upload", `${team.name}:${txn}`);
  revalidatePath("/dashboard");
  return { ok: "Payment proof received. Your team is marked Paid." };
}
