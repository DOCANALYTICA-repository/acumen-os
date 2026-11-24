"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, audit } from "@/lib/db";
import { createSession, hashPassword, requireAdmin } from "@/lib/auth";
import { sendEmailCode, verifyEmailCode } from "@/lib/email-code";
import { checkRateLimit, clientIp } from "@/lib/rate-limit";

const STAFF_ROLES = ["ADMIN", "JUDGE"] as const;
type StaffRole = (typeof STAFF_ROLES)[number];
const isStaffRole = (r: string): r is StaffRole => (STAFF_ROLES as readonly string[]).includes(r);
const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const emailOk = (e: string) => z.string().email().safeParse(e).success;

/** Who may get a code: an existing staff account, or an invite that no participant account shares. */
async function staffAccess(email: string) {
  const [user, invite] = await Promise.all([db.user.findUnique({ where: { email } }), db.staffInvite.findUnique({ where: { email } })]);
  if (user && isStaffRole(user.role)) return { user, invite, ok: true as const };
  if (user) return { ok: false as const, error: "This email belongs to a team account. Staff need a separate email." };
  if (invite) return { user: null, invite, ok: true as const };
  return { ok: false as const, error: "This email is not on the Acumen staff list. Ask an admin to invite you." };
}

// ---------------- Staff sign-in (Blossoms-style email code) ----------------

export type StaffLoginState = { step: "email" | "code"; email?: string; error?: string; info?: string };

export async function staffLogin(prev: StaffLoginState, fd: FormData): Promise<StaffLoginState> {
  const intent = s(fd, "intent");
  const email = (intent === "verify" || intent === "resend" ? prev.email ?? "" : s(fd, "email")).toLowerCase();
  if (intent === "back") return { step: "email", email };
  if (!emailOk(email)) return { step: "email", email, error: "Enter your staff email address." };

  if (intent === "send" || intent === "resend") {
    const step = intent === "resend" ? "code" : "email";
    const ip = await clientIp();
    if (!(await checkRateLimit("staff-code-ip", ip, 15, 3600)) || !(await checkRateLimit("staff-code", email, 5, 3600)))
      return { step, email, error: "Too many codes requested. Try again in an hour." };
    const access = await staffAccess(email);
    if (!access.ok) return { step: "email", email, error: access.error };
    const sent = await sendEmailCode(email);
    if (!sent.ok) return { step, email, error: sent.error };
    return { step: "code", email, info: intent === "resend" ? "A new code is on its way. Only the newest code works." : undefined };
  }

  if (intent !== "verify") return { step: "email", email };
  const code = s(fd, "code").replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) return { step: "code", email, error: "Enter the code from the email." };
  if (!(await checkRateLimit("staff-verify", email, 10, 900))) return { step: "code", email, error: "Too many attempts. Wait 15 minutes and request a new code." };
  if (!(await verifyEmailCode(email, code))) return { step: "code", email, error: "That code is wrong or has expired. Use the newest email, or resend." };

  // Re-check after the code: the invite may have been cancelled while the email was in flight.
  const access = await staffAccess(email);
  if (!access.ok) return { step: "email", email, error: access.error };
  let user = access.user;
  if (!user) {
    const invite = access.invite!;
    const passwordHash = await hashPassword(randomUUID() + randomUUID()); // never shown: invited staff sign in by code
    user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { fullName: invite.fullName, email, passwordHash, role: invite.role, college: "Staff" } });
      await tx.staffInvite.update({ where: { email }, data: { claimedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: created.id, action: "staff.claim", detail: `${email} (${invite.role})` } });
      return created;
    });
  }
  await createSession(user.id, user.role);
  redirect(user.role === "ADMIN" ? "/admin" : "/judge");
}

// ---------------- Admin: invites and staff accounts ----------------

export type InviteState = { error?: string; ok?: string } | undefined;

export async function inviteStaff(_: InviteState, fd: FormData): Promise<InviteState> {
  const admin = await requireAdmin();
  const email = s(fd, "email").toLowerCase();
  const fullName = s(fd, "fullName");
  const role = s(fd, "role");
  if (!emailOk(email)) return { error: "Enter a valid email." };
  if (fullName.length < 2) return { error: "Enter their name." };
  if (!isStaffRole(role)) return { error: "Pick a role." };
  const existing = await db.user.findUnique({ where: { email } });
  if (existing)
    return { error: isStaffRole(existing.role) ? "This person already has a staff account. Change their role in the list below." : "This email belongs to a team account. Use a different email for staff." };
  await db.staffInvite.upsert({ where: { email }, create: { email, fullName, role, invitedById: admin.id }, update: { fullName, role, invitedById: admin.id, claimedAt: null } });
  await audit(admin.id, "staff.invite", `${email} (${role})`);
  revalidatePath("/admin/staff");
  return { ok: `Invited ${email}. Send them the staff sign-in link; they get a code by email.` };
}

export async function cancelInvite(fd: FormData) {
  const admin = await requireAdmin();
  const email = s(fd, "email").toLowerCase();
  await db.staffInvite.deleteMany({ where: { email, claimedAt: null } });
  await audit(admin.id, "staff.uninvite", email);
  revalidatePath("/admin/staff");
}

/** Loads a staff account other than the caller's, refusing changes that would leave Acumen without an admin. */
async function otherStaff(adminId: string, id: string) {
  if (id === adminId) throw new Error("You cannot change or remove your own account.");
  const u = await db.user.findUniqueOrThrow({ where: { id } });
  if (!isStaffRole(u.role)) throw new Error("Not a staff account.");
  return u;
}

export async function setStaffRole(fd: FormData) {
  const admin = await requireAdmin();
  const role = s(fd, "role");
  if (!isStaffRole(role)) throw new Error("Pick a role.");
  const u = await otherStaff(admin.id, s(fd, "id"));
  if (u.role === role) return;
  await db.user.update({ where: { id: u.id }, data: { role } });
  await audit(admin.id, "staff.role", `${u.email}: ${u.role} -> ${role}`);
  revalidatePath("/admin/staff");
}

export async function removeStaff(fd: FormData) {
  const admin = await requireAdmin();
  const u = await otherStaff(admin.id, s(fd, "id"));
  await db.$transaction([db.user.delete({ where: { id: u.id } }), db.staffInvite.deleteMany({ where: { email: u.email } })]);
  await audit(admin.id, "staff.delete", u.email);
  revalidatePath("/admin/staff");
}
