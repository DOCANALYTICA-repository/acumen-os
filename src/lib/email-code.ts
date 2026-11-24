import "server-only";
import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getSecret } from "./auth";

/**
 * One-time staff sign-in codes, emailed through Brevo's transactional API.
 *
 * Acumen makes the code itself. Only a keyed hash of it (HMAC with AUTH_SECRET) goes into a signed, httpOnly
 * cookie on the browser that asked, so the code is never stored in the database and a copied cookie can't be
 * brute-forced offline. A new code replaces the cookie, so only the newest code works; a used code is cleared.
 *
 * Needs BREVO_API_KEY and BREVO_SENDER_EMAIL (a sender verified in Brevo). Without a key in development the code
 * is printed to the server console instead.
 */
const COOKIE = "acumen_staff_code";
const TTL_MIN = 10;

const digest = (email: string, code: string, exp: number) =>
  createHmac("sha256", getSecret()).update(`${email}:${code}:${exp}`).digest("base64url");

async function sendBrevo(email: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const key = process.env.BREVO_API_KEY;
  const sender = process.env.BREVO_SENDER_EMAIL;
  if (!key || !sender) {
    if (process.env.NODE_ENV !== "production") {
      console.info(`[staff sign-in] code for ${email}: ${code} (set BREVO_API_KEY to email it)`);
      return { ok: true };
    }
    return { ok: false, error: "Email sign-in is not set up yet. Ask an admin to add the Brevo settings." };
  }
  const html = `<div style="font-family:system-ui,sans-serif;font-size:16px;color:#111">
<p>Your Acumen staff sign-in code is</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>
<p style="color:#555">It works for ${TTL_MIN} minutes. If you didn't ask for it, ignore this email.</p></div>`;
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      sender: { email: sender, name: process.env.BREVO_SENDER_NAME || "Acumen" },
      to: [{ email }],
      subject: `${code} is your Acumen sign-in code`,
      htmlContent: html,
      textContent: `Your Acumen staff sign-in code is ${code}. It works for ${TTL_MIN} minutes.`,
    }),
    cache: "no-store",
  }).catch(() => null);
  if (res?.ok) return { ok: true };
  const data = res ? ((await res.json().catch(() => ({}))) as { message?: string }) : {};
  console.error("[staff sign-in] Brevo send failed", res?.status, data.message);
  if (res?.status === 401) return { ok: false, error: "The code email could not be sent (Brevo key rejected). Ask an admin to check BREVO_API_KEY." };
  if (res?.status === 429) return { ok: false, error: "Too many emails right now. Wait a minute and try again." };
  return { ok: false, error: "The code email could not be sent. Please try again, or ask an admin to check the Brevo settings." };
}

/** Emails a fresh 6-digit code and remembers its hash in this browser. */
export async function sendEmailCode(email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const exp = Math.floor(Date.now() / 1000) + TTL_MIN * 60;
  const sent = await sendBrevo(email, code);
  if (!sent.ok) return sent;
  const token = await new SignJWT({ email, h: digest(email, code, exp) })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(exp)
    .sign(getSecret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_MIN * 60,
  });
  return { ok: true };
}

/** True when `code` is the newest unexpired code sent to `email` from this browser. Clears it on success. */
export async function verifyEmailCode(email: string, code: string): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (payload.email !== email || typeof payload.h !== "string" || typeof payload.exp !== "number") return false;
    const want = Buffer.from(payload.h);
    const got = Buffer.from(digest(email, code, payload.exp));
    if (want.length !== got.length || !timingSafeEqual(want, got)) return false;
    jar.delete(COOKIE);
    return true;
  } catch {
    return false;
  }
}
