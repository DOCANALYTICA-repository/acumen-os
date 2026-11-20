import Link from "next/link";
import type { ReactNode } from "react";

export const cls = {
  btn: "inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed",
  primary: "bg-gradient-to-r from-sky-600 to-sky-500 text-white shadow-[0_6px_18px_rgba(37,99,235,0.3)] hover:shadow-[0_10px_26px_rgba(37,99,235,0.4)] hover:brightness-105",
  secondary: "border border-white/70 bg-white/70 text-ink backdrop-blur-md hover:bg-white hover:shadow-soft",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "text-brand hover:underline",
  input: "w-full rounded-xl border border-line/80 bg-white/80 px-3 py-2 text-sm text-ink outline-none transition focus:border-sky-400 focus:bg-white focus:ring-4 focus:ring-sky-100",
  label: "mb-1 block text-sm font-medium text-ink",
  th: "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted",
  td: "px-3 py-2 align-top text-sm",
};

export function Container({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`glass min-w-0 overflow-x-auto rounded-3xl p-5 sm:p-6 ${className}`}>
      {(title || action) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const tones = {
  gray: "bg-gray-100 text-gray-700",
  green: "bg-emerald-100 text-emerald-800",
  amber: "bg-amber-100 text-amber-800",
  red: "bg-red-100 text-red-700",
  blue: "bg-blue-100 text-blue-800",
  brand: "bg-brand/10 text-brand",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Alert({ tone = "blue", children }: { tone?: Tone; children: ReactNode }) {
  return <div className={`rounded-2xl px-4 py-3 text-sm ${tones[tone]}`}>{children}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="glass rounded-3xl p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-glass-lg">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-bold text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className={cls.label}>{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function LinkButton({ href, children, variant = "primary" }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  return (
    <Link href={href} className={`${cls.btn} ${cls[variant]}`}>
      {children}
    </Link>
  );
}

/** Plain anchor for file downloads (API routes), which must not go through client-side navigation. */
export function DownloadLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} download className={`${cls.btn} ${cls.secondary}`}>
      {children}
    </a>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-3xl border border-dashed border-sky-200 bg-white/40 px-4 py-10 text-center text-sm text-muted backdrop-blur">{children}</div>;
}

export function fmtDate(d: Date | null | undefined, withTime = true) {
  if (!d) return "—";
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
    timeZone: "Asia/Kolkata",
  });
}

export function statusTone(s: string): Tone {
  if (["LIVE", "PAID"].includes(s)) return "green";
  if (["UPCOMING", "COMPLETE", "SCHEDULED", "UNPAID"].includes(s)) return "amber";
  if (["CLOSED", "DRAFT", "INCOMPLETE"].includes(s)) return "gray";
  return "red";
}
