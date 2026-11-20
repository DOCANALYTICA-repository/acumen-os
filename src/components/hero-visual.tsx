"use client";

import { motion } from "framer-motion";
import { Gavel, Network, Target, Trophy } from "lucide-react";

const ease = [0.22, 1, 0.36, 1] as const;

// Five rounds as a rising staircase; heights narrow toward the top like an elimination path.
const BARS = [
  { x: 70, h: 80, label: "R1" },
  { x: 140, h: 120, label: "R2" },
  { x: 210, h: 160, label: "R3" },
  { x: 280, h: 200, label: "R4" },
  { x: 350, h: 240, label: "R5" },
];
const BASE = 360;

function Chip({ className, delay, children }: { className: string; delay: number; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1, y: [0, -10, 0] }}
      transition={{ opacity: { delay, duration: 0.5 }, scale: { delay, duration: 0.5, ease }, y: { delay: delay + 0.5, duration: 5, repeat: Infinity, ease: "easeInOut" } }}
      className={`absolute flex items-center gap-2 rounded-2xl border border-white/70 bg-white/75 px-3 py-2 text-xs font-semibold text-ink shadow-glass backdrop-blur-xl ${className}`}
    >
      {children}
    </motion.div>
  );
}

/** Hero illustration: five bars grow in sequence, an arrow climbs them to a trophy, chips float around. */
export function HeroVisual({ className = "" }: { className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <div className="absolute inset-0 -z-10 scale-110 rounded-full bg-[radial-gradient(60%_50%_at_60%_40%,rgba(96,165,250,0.30)_0%,transparent_70%)] blur-2xl" />

      <motion.div initial={{ opacity: 0, scale: 0.92, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 0.9, ease }} className="animate-float-slow">
        <svg viewBox="0 0 480 420" className="h-full w-full" role="img" aria-label="Five rounds rising to the final">
          <defs>
            <linearGradient id="hv-panel" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#dbeafe" stopOpacity="0.55" />
            </linearGradient>
            <linearGradient id="hv-bar" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor="#1d4ed8" />
              <stop offset="100%" stopColor="#60a5fa" />
            </linearGradient>
            <linearGradient id="hv-arrow" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#fbbf24" />
            </linearGradient>
            <filter id="hv-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="20" stdDeviation="22" floodColor="#2563eb" floodOpacity="0.22" />
            </filter>
          </defs>

          <rect x="30" y="40" width="420" height="350" rx="36" fill="url(#hv-panel)" stroke="#ffffff" strokeOpacity="0.8" filter="url(#hv-shadow)" />
          {[0, 1, 2, 3].map((i) => (
            <line key={i} x1="60" x2="420" y1={BASE - 60 * (i + 1)} y2={BASE - 60 * (i + 1)} stroke="#2563eb" strokeOpacity="0.07" />
          ))}

          {BARS.map((b, i) => (
            <g key={b.label}>
              <motion.rect
                x={b.x}
                width="46"
                rx="12"
                fill="url(#hv-bar)"
                initial={{ height: 0, y: BASE }}
                animate={{ height: b.h, y: BASE - b.h }}
                transition={{ duration: 0.8, delay: 0.4 + i * 0.15, ease }}
              />
              <motion.text
                x={b.x + 23}
                y={BASE + 22}
                textAnchor="middle"
                fontSize="13"
                fontWeight="700"
                fill="#4b5563"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 + i * 0.15 }}
              >
                {b.label}
              </motion.text>
            </g>
          ))}

          <motion.path
            d="M80 250 C 140 230, 170 200, 233 170 S 330 110, 380 80"
            fill="none"
            stroke="url(#hv-arrow)"
            strokeWidth="9"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 1.2, delay: 1.3, ease: "easeInOut" }}
          />
          <motion.path
            d="M362 72 L384 78 L378 100"
            fill="none"
            stroke="url(#hv-arrow)"
            strokeWidth="9"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: 2.4 }}
            style={{ transformOrigin: "380px 80px" }}
          />
        </svg>
      </motion.div>

      <Chip className="left-0 top-[38%]" delay={1.6}><Target className="h-4 w-4 text-sky-600" /> Guesstimate</Chip>
      <Chip className="left-[26%] top-[11%]" delay={1.9}><Gavel className="h-4 w-4 text-emerald-600" /> Setup auction</Chip>
      <Chip className="-bottom-1 right-[8%]" delay={2.2}><Network className="h-4 w-4 text-amber-600" /> Economy simulation</Chip>
      <motion.div
        initial={{ opacity: 0, scale: 0.4, rotate: -20 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        transition={{ delay: 2.6, type: "spring", stiffness: 260, damping: 14 }}
        className="absolute right-[12%] top-[2%] grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-[0_12px_30px_rgba(245,158,11,0.45)]"
      >
        <Trophy className="h-7 w-7" />
      </motion.div>
    </div>
  );
}
