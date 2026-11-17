"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db, audit } from "@/lib/db";
import { createSession, destroySession, hashPassword, verifyPassword } from "@/lib/auth";
import { getContent, registrationOpen } from "@/lib/content";

export type FormState = { error?: string; ok?: string } | undefined;

const registerSchema = z.object({
  fullName: z.string().trim().min(2, "Enter your full name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  phone: z.string().trim().min(8, "Enter a valid phone number").max(20),
  college: z.string().trim().min(2, "Enter your college").max(120),
  year: z.string().trim().min(1, "Select your year"),
  city: z.string().trim().max(60).optional(),
  source: z.string().trim().max(60).optional(),
  consent: z.literal("on", { message: "Please accept the terms to continue" }),
});

export async function register(_: FormState, formData: FormData): Promise<FormState> {
  const content = await getContent();
  if (!registrationOpen(content)) return { error: "Registrations are closed." };

  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const d = parsed.data;

  if (await db.user.findUnique({ where: { email: d.email } })) return { error: "An account with this email already exists. Log in instead." };

  const user = await db.user.create({
    data: {
      fullName: d.fullName,
      email: d.email,
      passwordHash: await hashPassword(d.password),
      phone: d.phone,
      college: d.college,
      year: d.year,
      city: d.city || null,
      source: d.source || null,
    },
  });
  await audit(user.id, "user.register", d.email);
  await createSession(user.id, user.role);
  redirect("/dashboard");
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
