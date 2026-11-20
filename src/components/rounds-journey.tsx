"use client";

import { motion } from "framer-motion";
import { ClipboardCheck, FileUp, Network, Sheet, Target } from "lucide-react";
import { scaleIn, stagger } from "./motion";

export type JourneyRound = { id: string; order: number; title: string; type: string; description: string; status: string; window: string };

const ICON = { QUIZ: Target, EXCEL: Sheet, SUBMISSION: FileUp, SIMULATION: Network, MANUAL: ClipboardCheck } as const;
const TINT = { QUIZ: "text-sky-600", EXCEL: "text-emerald-600", SUBMISSION: "text-violet-600", SIMULATION: "text-amber-600", MANUAL: "text-violet-600" } as const;
const STATUS: Record<string, string> = {
  LIVE: "bg-emerald-100 text-emerald-700",
  UPCOMING: "bg-amber-100 text-amber-800",
  CLOSED: "bg-gray-100 text-gray-600",
  DRAFT: "bg-sky-50 text-sky-700",
};

/** Five round cards joined by a line that draws itself as the section scrolls in. */
export function RoundsJourney({ rounds }: { rounds: JourneyRound[] }) {
  return (
    <div className="relative">
      <svg className="absolute left-0 right-0 top-9 hidden h-2 w-full lg:block" viewBox="0 0 100 2" preserveAspectRatio="none" aria-hidden>
        <motion.line
          x1="10" x2="90" y1="1" y2="1"
          stroke="url(#journey-line)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeDasharray="0"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 1.4, ease: "easeInOut" }}
        />
        <defs>
          <linearGradient id="journey-line" x1="0" x2="1">
            <stop offset="0%" stopColor="#93c5fd" />
            <stop offset="100%" stopColor="#f59e0b" />
          </linearGradient>
        </defs>
      </svg>

      <motion.ol variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }} className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {rounds.map((r) => {
          const Icon = ICON[r.type as keyof typeof ICON] ?? FileUp;
          return (
            <motion.li
              key={r.id}
              variants={scaleIn}
              whileHover={{ y: -8 }}
              transition={{ type: "spring", stiffness: 300, damping: 22 }}
              className="group flex flex-col rounded-3xl border border-white/60 bg-white/60 p-5 shadow-glass backdrop-blur-xl"
            >
              <div className="flex items-center justify-between">
                <span className={`grid h-12 w-12 place-items-center rounded-2xl bg-white shadow-soft ring-4 ring-surface transition-transform duration-300 group-hover:rotate-6 ${TINT[r.type as keyof typeof TINT] ?? ""}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${STATUS[r.status] ?? STATUS.DRAFT}`}>
                  {r.status === "DRAFT" ? "Soon" : r.status.toLowerCase()}
                </span>
              </div>
              <div className="mt-5 text-xs font-bold uppercase tracking-wider text-sky-600">Round {r.order}</div>
              <h3 className="mt-1 text-lg font-semibold text-ink">{r.title}</h3>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-muted">{r.description}</p>
              <p className="mt-4 border-t border-line pt-3 text-xs text-muted">{r.window}</p>
            </motion.li>
          );
        })}
      </motion.ol>
    </div>
  );
}
