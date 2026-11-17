import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { Container } from "@/components/ui";

const items = [
  ["/admin", "Dashboard"],
  ["/admin/rounds", "Rounds"],
  ["/admin/teams", "Teams"],
  ["/admin/participants", "Participants"],
  ["/admin/submissions", "Submissions & judging"],
  ["/admin/results", "Results & leaderboard"],
  ["/admin/analytics", "Analytics"],
  ["/admin/content", "Content & settings"],
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <Container className="py-8">
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside>
          <nav className="flex gap-1 overflow-x-auto lg:sticky lg:top-24 lg:flex-col">
            {items.map(([href, label]) => (
              <Link key={href} href={href} className="whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium text-ink/80 hover:bg-white hover:text-ink">
                {label}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </Container>
  );
}
