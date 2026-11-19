"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveResult } from "@/lib/live-quiz-types";

/** Colour + shape per answer slot, so options are recognisable on the projector and on phones (and without colour). */
export const SLOTS = [
  { bg: "bg-rose-600", soft: "bg-rose-100", text: "text-rose-700", shape: "triangle" },
  { bg: "bg-sky-600", soft: "bg-sky-100", text: "text-sky-700", shape: "diamond" },
  { bg: "bg-amber-500", soft: "bg-amber-100", text: "text-amber-700", shape: "circle" },
  { bg: "bg-emerald-600", soft: "bg-emerald-100", text: "text-emerald-700", shape: "square" },
  { bg: "bg-violet-600", soft: "bg-violet-100", text: "text-violet-700", shape: "hexagon" },
  { bg: "bg-orange-600", soft: "bg-orange-100", text: "text-orange-700", shape: "star" },
] as const;

/** True / False get their own two slots. */
export const TF_SLOTS = [SLOTS[1], SLOTS[0]] as const;

export function Shape({ shape, className = "h-6 w-6" }: { shape: string; className?: string }) {
  const p = { fill: "currentColor" };
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      {shape === "triangle" && <path d="M12 3 22 20H2z" {...p} />}
      {shape === "diamond" && <path d="M12 2 22 12 12 22 2 12z" {...p} />}
      {shape === "circle" && <circle cx="12" cy="12" r="10" {...p} />}
      {shape === "square" && <rect x="3" y="3" width="18" height="18" rx="2" {...p} />}
      {shape === "hexagon" && <path d="M7 3h10l5 9-5 9H7l-5-9z" {...p} />}
      {shape === "star" && <path d="m12 2 3 7h7l-5.5 4.5 2 7.5L12 16.5 5.5 21l2-7.5L2 9h7z" {...p} />}
    </svg>
  );
}

/**
 * Polls a live-quiz state endpoint once a second and keeps a server-clock offset,
 * so countdowns agree across devices whatever their local clocks say.
 */
export function useLivePoll<T extends { serverNow: number }>(url: string, initial: T) {
  const [state, setState] = useState<T>(initial);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null); // null until mounted: no SSR clock mismatch
  const offset = useRef(0);
  const seed = useRef(initial.serverNow);
  const mounted = useRef(false);

  const fetchOnce = useCallback(async () => {
    const t0 = Date.now();
    const ctl = new AbortController();
    const guard = setTimeout(() => ctl.abort(), 8000); // a stuck request must not stall the loop
    try {
      const res = await fetch(url, { cache: "no-store", signal: ctl.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Connection problem");
      offset.current = body.serverNow - (t0 + Date.now()) / 2;
      if (mounted.current) {
        setState(body as T);
        setError(null);
      }
    } catch (e) {
      if (mounted.current) setError(ctl.signal.aborted ? "Server is slow to respond" : (e as Error).message);
    } finally {
      clearTimeout(guard);
    }
  }, [url]);

  useEffect(() => {
    // `active` is per effect run, so a remount (Strict Mode, Fast Refresh) never leaves a second loop running.
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    mounted.current = true;
    offset.current = seed.current - Date.now();
    setNow(Date.now() + offset.current);
    const loop = async () => {
      await fetchOnce();
      if (active) timer = setTimeout(loop, 1000);
    };
    timer = setTimeout(loop, 1000);
    const tick = setInterval(() => setNow(Date.now() + offset.current), 200);
    return () => {
      active = false;
      mounted.current = false;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [fetchOnce]);

  return { state, error, now, refetch: fetchOnce };
}

/**
 * Sends a host command or a team's answer. Never hangs: gives up after 8 s, and since commands are
 * idempotent and a team can answer only once, the next poll shows what actually happened.
 */
export async function postLive(roundId: string, body: { command?: string; index: number; answer?: unknown }): Promise<LiveResult | null> {
  const ctl = new AbortController();
  const guard = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(`/api/live/${roundId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
    const data = (await res.json().catch(() => null)) as LiveResult | null;
    return data ?? { ok: false, error: `Server error (${res.status})` };
  } catch {
    return ctl.signal.aborted ? null : { ok: false, error: "Couldn't reach the server. Check your connection and try again." };
  } finally {
    clearTimeout(guard);
  }
}

/** Whole seconds left until `at` (ceil), never negative. */
export function secondsUntil(at: number | null, now: number | null) {
  if (at === null || now === null) return null;
  return Math.max(0, Math.ceil((at - now) / 1000));
}

export function TimerRing({ endsAt, opensAt, now, size = 96 }: { endsAt: number | null; opensAt: number | null; now: number | null; size?: number }) {
  const left = secondsUntil(endsAt, now);
  if (left === null || endsAt === null || opensAt === null || now === null) return null;
  const total = Math.max(1, (endsAt - opensAt) / 1000);
  const frac = Math.min(1, Math.max(0, (endsAt - now) / 1000 / total));
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="timer" aria-label={`${left} seconds left`}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="white" stroke="#e5e7eb" strokeWidth="8" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={left <= 5 ? "#dc2626" : "#0284c7"} strokeWidth="8" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} className="transition-[stroke-dashoffset] duration-200 ease-linear" />
      </svg>
      <span className={`absolute inset-0 grid place-items-center font-mono font-bold tabular-nums ${left <= 5 ? "text-red-600" : "text-ink"}`} style={{ fontSize: size * 0.34 }}>{left}</span>
    </div>
  );
}

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function fmtPoints(n: number) {
  return n.toLocaleString("en-IN");
}

/** Human-readable correct answer for a question. */
export function answerText(type: string, options: string[], answer: unknown) {
  if (type === "SINGLE") return options[answer as number] ?? "";
  if (type === "MULTI") return Array.isArray(answer) ? answer.map((i) => options[i]).join(", ") : "";
  if (type === "TRUEFALSE") return answer ? "True" : "False";
  return String(answer ?? "");
}

export const TYPE_HINT: Record<string, string> = {
  SINGLE: "Pick one",
  MULTI: "Pick all that apply",
  TRUEFALSE: "True or false",
  SHORT: "Type the answer",
};
