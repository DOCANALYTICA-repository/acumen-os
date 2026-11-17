"use client";

import { MotionConfig, motion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

export const easeOut = [0.22, 1, 0.36, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: easeOut } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 16 },
  show: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.55, ease: easeOut } },
};

export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.09, delayChildren: 0.05 } },
};

/** Honors the OS "reduce motion" setting for every animation below it. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Fades content up once it scrolls into view. */
export function Reveal({ children, className, delay = 0, amount = 0.25 }: { children: ReactNode; className?: string; delay?: number; amount?: number }) {
  return (
    <motion.div className={className} variants={fadeUp} initial="hidden" whileInView="show" viewport={{ once: true, amount }} transition={{ delay }}>
      {children}
    </motion.div>
  );
}

/** Cascades its StaggerItem children in as the group scrolls into view. */
export function Stagger({ children, className, amount = 0.15, onLoad = false }: { children: ReactNode; className?: string; amount?: number; onLoad?: boolean }) {
  return (
    <motion.div
      className={className}
      variants={stagger}
      initial="hidden"
      {...(onLoad ? { animate: "show" } : { whileInView: "show", viewport: { once: true, amount } })}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className, lift = false, variant = "fadeUp" }: { children: ReactNode; className?: string; lift?: boolean; variant?: "fadeUp" | "scaleIn" }) {
  return (
    <motion.div
      className={className}
      variants={variant === "scaleIn" ? scaleIn : fadeUp}
      {...(lift ? { whileHover: { y: -6 }, transition: { type: "spring", stiffness: 300, damping: 22 } } : {})}
    >
      {children}
    </motion.div>
  );
}

/** Slow-drifting blurred color fields behind the hero. Decorative only. */
export function AmbientBlobs() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <motion.div
        className="absolute -right-24 -top-24 h-[28rem] w-[28rem] rounded-full bg-sky-400/25 blur-3xl"
        animate={{ x: [0, -40, 0], y: [0, 30, 0], scale: [1, 1.08, 1] }}
        transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute -left-32 top-40 h-[24rem] w-[24rem] rounded-full bg-sky-200/40 blur-3xl"
        animate={{ x: [0, 50, 0], y: [0, -20, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="absolute bottom-0 left-1/2 h-72 w-72 rounded-full bg-amber-200/30 blur-3xl"
        animate={{ x: [0, -30, 0], scale: [1, 1.15, 1] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
      />
      {/* faint grid, faded toward the edges */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(37,99,235,0.06)_1px,transparent_1px),linear-gradient(to_bottom,rgba(37,99,235,0.06)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_60%_55%_at_50%_40%,#000_30%,transparent_80%)]" />
    </div>
  );
}

export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: easeOut }}>
      {children}
    </motion.div>
  );
}
