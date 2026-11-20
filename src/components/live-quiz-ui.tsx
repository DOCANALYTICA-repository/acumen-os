"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LiveResult } from "@/lib/live-quiz-types";

/**
 * Polls a live-round state endpoint about once a second. Each effect run owns its own loop, so a
 * remount (Strict Mode, Fast Refresh) never leaves a second loop running.
 */
export function useLivePoll<T extends { serverNow: number }>(url: string, initial: T) {
  const [state, setState] = useState<T>(initial);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);

  const fetchOnce = useCallback(async () => {
    const ctl = new AbortController();
    const guard = setTimeout(() => ctl.abort(), 8000); // a stuck request must not stall the loop
    try {
      const res = await fetch(url, { cache: "no-store", signal: ctl.signal });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Connection problem");
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
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    mounted.current = true;
    const loop = async () => {
      await fetchOnce();
      if (active) timer = setTimeout(loop, 1000);
    };
    timer = setTimeout(loop, 1000);
    return () => {
      active = false;
      mounted.current = false;
      clearTimeout(timer);
    };
  }, [fetchOnce]);

  return { state, error, refetch: fetchOnce };
}

/**
 * Sends a host command or a team's answer. Never hangs: gives up after 8 s (returns null), and the next
 * poll shows what actually happened.
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

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
