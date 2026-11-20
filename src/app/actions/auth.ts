"use server";

import { redirect } from "next/navigation";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { getContent, registrationOpen } from "@/lib/content";
import { deleteStoredFile, saveUpload } from "@/lib/files";
import { receiptError, registrationSchema } from "@/lib/registration";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

export type FormState = { error?: string; ok?: string } | undefined;

/**
 * Team registration in one go (Bidwave-style): the captain enters both members, a password and the payment receipt.
 * Both members get a User row (for the roster, analytics and certificates) but only the captain can log in: the
 * second member's password is random and never shown. The team is active immediately (payment auto-accepted);
 * organisers check receipts in Admin → Teams and can reject one, which locks the team out until it re-uploads.
 */
export async function registerTeam(_: FormState, formData: FormData): Promise<FormState> {
  const content = await getContent();
  if (!registrationOpen(content)) return { error: "Registrations are closed." };
  // Stops scripted sign-ups while leaving room for a whole campus on one shared Wi-Fi (same public IP).
  const perHour = Number(process.env.REGISTER_LIMIT_PER_HOUR) || 20;
  if (!(await checkRateLimit("register", await clientIp(), perHour, 3600)))
    return { error: "Too many registration attempts from this network. Please try again in an hour, or contact the organisers." };

  let members: unknown;
  try {
    members = JSON.parse(String(formData.get("members") ?? "[]"));
  } catch {
    return { error: "Something went wrong with the form. Please refresh and try again." };
  }
  const parsed = registrationSchema.safeParse({
    teamName: formData.get("teamName"),
    members,
    password: formData.get("password"),
    passwordConfirm: formData.get("passwordConfirm"),
    city: formData.get("city") ?? "",
    source: formData.get("source") ?? "",
    transactionId: formData.get("transactionId") ?? "",
    consent: formData.get("consent") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;
  const receipt = formData.get("receipt");
  const receiptProblem = receiptError(receipt instanceof File ? receipt : null);
  if (receiptProblem) return { error: receiptProblem };

  const emails = d.members.map((m) => m.email);
  const taken = await db.user.findMany({ where: { email: { in: emails } }, select: { email: true } });
  if (taken.length) return { error: `${taken.map((t) => t.email).join(" and ")} ${taken.length > 1 ? "are" : "is"} already registered. Each person can be in one team only.` };
  const names = await db.team.findMany({ select: { name: true } });
  if (names.some((t) => t.name.toLowerCase() === d.teamName.toLowerCase())) return { error: "That team name is taken." };

  const teamId = randomUUID();
  const saved = await saveUpload(receipt as File, `teams/${teamId}/payment`);
  const [captain, mate] = d.members;
  try {
    const unusable = await hashPassword(randomUUID() + randomUUID());
    await db.$transaction(async (tx) => {
      const lead = await tx.user.create({
        data: { ...captain, passwordHash: await hashPassword(d.password), city: d.city || null, source: d.source || null },
      });
      const second = await tx.user.create({ data: { ...mate, passwordHash: unusable, city: d.city || null } });
      await tx.team.create({
        data: {
          id: teamId,
          name: d.teamName,
          paymentScreenshot: saved.path,
          transactionId: d.transactionId || null,
          paymentStatus: "PAID",
          members: { create: [{ userId: lead.id, isLead: true }, { userId: second.id }] },
        },
      });
      await tx.auditLog.create({ data: { actorId: lead.id, action: "team.register", detail: `${d.teamName}:${emails.join(",")}` } });
    });
  } catch {
    await deleteStoredFile(saved.path);
    return { error: "Registration failed: the team name or an email was just taken. Please check and try again." };
  }
  redirect(`/register/success?team=${encodeURIComponent(d.teamName)}`);
}

export async function login(_: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) return { error: "Wrong email or password." };
  await createSession(user.id, user.role);
  redirect(user.role === "ADMIN" ? "/admin" : user.role === "JUDGE" ? "/judge" : "/dashboard");
}

export async function logout() {
  await destroySession();
  redirect("/");
}
