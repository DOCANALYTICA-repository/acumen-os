
/** Acumen mark: three rising bars and an upward arrow inside a gradient tile. */
export function AcumenMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} role="img" aria-label="Acumen">
      <defs>
        <linearGradient id="acm-tile" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7eb2ff" />
          <stop offset="55%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <linearGradient id="acm-bar" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0%" stopColor="#bfdbfe" />
          <stop offset="100%" stopColor="#ffffff" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#acm-tile)" />
      <rect x="14" y="36" width="8" height="14" rx="2.5" fill="url(#acm-bar)" />
      <rect x="26" y="28" width="8" height="22" rx="2.5" fill="url(#acm-bar)" />
      <rect x="38" y="20" width="8" height="30" rx="2.5" fill="url(#acm-bar)" />
      <path d="M13 30 L29 18 L37 23 L50 12" fill="none" stroke="#fbbf24" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M44 11 L51 11 L51 18" fill="none" stroke="#fbbf24" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function BrandLogo({ name = "Acumen" }: { name?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <AcumenMark />
      <span className="text-lg font-bold tracking-tight text-ink">{name}</span>
    </span>
  );
}
