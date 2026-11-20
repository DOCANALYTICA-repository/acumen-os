import "server-only";
import { headers } from "next/headers";
import { db } from "./db";

/** The caller's IP as seen by the host (Vercel sets x-forwarded-for; the first entry is the client). */
export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Fixed-window limiter: allows `limit` calls per `windowSeconds` for one bucket + identifier.
 * Returns true while under the limit. Counters live in the database so every server instance shares them.
 */
export async function checkRateLimit(bucket: string, identifier: string, limit: number, windowSeconds: number) {
  const key = `${bucket}:${identifier}`.slice(0, 200);
  const now = new Date();
  const row = await db.rateLimit.upsert({
    where: { key },
    create: { key, count: 1, windowStart: now },
    update: { count: { increment: 1 } },
  });
  if (now.getTime() - row.windowStart.getTime() > windowSeconds * 1000) {
    await db.rateLimit.update({ where: { key }, data: { count: 1, windowStart: now } });
    return true;
  }
  return row.count <= limit;
}
