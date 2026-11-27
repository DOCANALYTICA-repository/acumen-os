import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { db } from "./db";

const COOKIE = "acumen_session";
let cachedSecret: Uint8Array | null = null;

/** Signing key for sessions. In production a real AUTH_SECRET (32+ characters) is required. */
export function getSecret() {
  if (cachedSecret) return cachedSecret;
  const value = process.env.AUTH_SECRET ?? "";
  if (process.env.NODE_ENV === "production" && (value.length < 32 || value === "dev-secret"))
    throw new Error("AUTH_SECRET must be set to a random string of at least 32 characters in production.");
  cachedSecret = new TextEncoder().encode(value || "dev-secret");
  return cachedSecret;
}

export type Role = "PARTICIPANT" | "JUDGE" | "ADMIN";

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function createSession(userId: string, role: string) {
  const token = await new SignJWT({ uid: userId, role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecret());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSessionUserId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return typeof payload.uid === "string" ? payload.uid : null;
  } catch {
    return null;
  }
}

/**
 * Current user with team membership, or null. Role is always read fresh from the DB, once per request:
 * React's cache() shares the result between the nav, layouts and the page rendering in the same request.
 */
export const getCurrentUser = cache(async () => {
  const uid = await getSessionUserId();
  if (!uid) return null;
  return db.user.findUnique({
    where: { id: uid },
    include: { membership: { include: { team: { include: { members: { include: { user: true } } } } } } },
  });
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireRole(...roles: Role[]) {
  const user = await requireUser();
  if (!roles.includes(user.role as Role)) redirect("/");
  return user;
}

export const requireAdmin = () => requireRole("ADMIN");
