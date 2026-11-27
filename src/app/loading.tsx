import { Container } from "@/components/ui";

/** Shown at once when a page is opened, while the server prepares it (Next.js streams the page in after). */
export default function Loading() {
  return (
    <Container className="py-8">
      <span className="sr-only" role="status">Loading…</span>
      <div className="animate-pulse space-y-4" aria-hidden>
        <div className="h-8 w-64 max-w-full rounded-xl bg-line/60" />
        <div className="h-4 w-96 max-w-full rounded-lg bg-line/40" />
        <div className="grid gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-32 rounded-2xl bg-white/70 shadow-soft" />)}
        </div>
        <div className="h-64 rounded-2xl bg-white/70 shadow-soft" />
      </div>
    </Container>
  );
}
