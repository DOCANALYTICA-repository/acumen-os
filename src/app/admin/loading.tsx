/** Admin pages: the sidebar stays (it lives in the layout); only the content area shows this while loading. */
export default function AdminLoading() {
  return (
    <div>
      <span className="sr-only" role="status">Loading…</span>
      <div className="animate-pulse space-y-4" aria-hidden>
        <div className="h-8 w-56 max-w-full rounded-xl bg-line/60" />
        <div className="h-4 w-80 max-w-full rounded-lg bg-line/40" />
        <div className="grid gap-4 pt-2 sm:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl bg-white/70 shadow-soft" />)}
        </div>
        <div className="h-72 rounded-2xl bg-white/70 shadow-soft" />
      </div>
    </div>
  );
}
