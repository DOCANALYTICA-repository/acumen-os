"use server";

import { revalidatePath } from "next/cache";
import { db, audit } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { getContent, registrationOpen } from "@/lib/content";
import { deleteStoredFile, saveUpload } from "@/lib/files";
import { receiptError, teamNameSchema } from "@/lib/registration";
import type { FormState } from "./auth";

async function nameTaken(name: string, exceptTeamId?: string) {
  const all = await db.team.findMany({ select: { id: true, name: true } });
  return all.some((t) => t.id !== exceptTeamId && t.name.toLowerCase() === name.toLowerCase());
}

/** Live availability check for the registration wizard and the rename form. */
export async function checkTeamName(raw: string) {
  const parsed = teamNameSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  if (await nameTaken(parsed.data)) return { ok: false, message: "That name is taken." };
  return { ok: true, message: "Available" };
}

/** Teams log in as their captain; this returns the captain's team. */
async function requireCaptain() {
  const user = await requireRole("PARTICIPANT");
  const m = user.membership;
  if (!m?.isLead) throw new Error("Only the team captain can do this.");
  return { user, team: m.team };
}

export async function renameTeam(_: FormState, fd: FormData): Promise<FormState> {
  try {
    const { user, team } = await requireCaptain();
    if (!registrationOpen(await getContent())) return { error: "Registrations are closed, so the team name is locked." };
    const parsed = teamNameSchema.safeParse(fd.get("name"));
    if (!parsed.success) return { error: parsed.error.issues[0].message };
    if (await nameTaken(parsed.data, team.id)) return { error: "That team name is taken." };
    await db.team.update({ where: { id: team.id }, data: { name: parsed.data } });
    await audit(user.id, "team.rename", `${team.name} -> ${parsed.data}`);
    revalidatePath("/dashboard");
    return { ok: "Team renamed." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** After an organiser rejects a receipt, the captain attaches a new one; the team is active again straight away. */
export async function reuploadReceipt(_: FormState, fd: FormData): Promise<FormState> {
  let ctx;
  try {
    ctx = await requireCaptain();
  } catch (e) {
    return { error: (e as Error).message };
  }
  const { user, team } = ctx;
  if (team.paymentStatus !== "REJECTED") return { error: "Your receipt has not been rejected." };
  const file = fd.get("receipt");
  const problem = receiptError(file instanceof File ? file : null);
  if (problem) return { error: problem };
  const txn = String(fd.get("transactionId") ?? "").trim().slice(0, 64);

  const saved = await saveUpload(file as File, `teams/${team.id}/payment`);
  await db.team.update({ where: { id: team.id }, data: { paymentScreenshot: saved.path, transactionId: txn || team.transactionId, paymentStatus: "PAID" } });
  if (team.paymentScreenshot) await deleteStoredFile(team.paymentScreenshot);
  await audit(user.id, "team.payment_reupload", `${team.name}:${txn}`);
  revalidatePath("/dashboard");
  return { ok: "New receipt received. Your team is active again." };
}
