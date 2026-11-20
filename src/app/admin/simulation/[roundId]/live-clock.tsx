"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Countdown for the open decision window; refreshes the control room every 10 s so new decisions and auto-advance show up. */
export function LiveClock({ endsAt, refreshMs = 10_000 }: { endsAt: number | null; refreshMs?: number }) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null); // null until mounted, so SSR and client markup match
  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const refresh = setInterval(() => router.refresh(), refreshMs);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [router, refreshMs]);
  if (endsAt === null || now === null) return null;
  const left = Math.max(0, Math.floor((endsAt - now) / 1000));
  return (
    <span className={`font-mono text-2xl font-bold tabular-nums ${left < 60 ? "text-red-600" : "text-ink"}`}>
      {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
    </span>
  );
}
