"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

/** Live countdown to an ISO date. Renders nothing until mounted to avoid hydration mismatch. */
export function Countdown({ to, label }: { to: string; label: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return null;
  const left = new Date(to).getTime() - now;
  if (left <= 0) return null;
  const p = parts(left);
  return (
    <div className="mt-8">
      <div className="text-xs font-semibold uppercase tracking-widest text-muted">{label}</div>
      <div className="mt-2 flex gap-2.5">
        {([["Days", p.d], ["Hours", p.h], ["Min", p.m], ["Sec", p.s]] as const).map(([k, v]) => (
          <div key={k} className="glass min-w-16 overflow-hidden rounded-2xl px-3 py-2 text-center">
            <div className="relative h-8 text-2xl font-bold tabular-nums text-ink">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.span key={v} initial={{ y: -16, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 16, opacity: 0 }} transition={{ duration: 0.3 }} className="block">
                  {String(v).padStart(2, "0")}
                </motion.span>
              </AnimatePresence>
            </div>
            <div className="text-[11px] uppercase tracking-wide text-muted">{k}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
