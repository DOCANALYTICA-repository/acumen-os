import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { Card, Empty, PageHeader, cls } from "@/components/ui";

export default async function SimulationIndex() {
  const rounds = await db.round.findMany({ where: { type: "SIMULATION" }, orderBy: { order: "asc" }, include: { economy: { select: { status: true, currentCycle: true } } } });
  if (rounds.length === 1) redirect(`/admin/simulation/${rounds[0].id}`);
  return (
    <>
      <PageHeader title="Simulation control" subtitle="Business simulation rounds" />
      {rounds.length === 0 ? (
        <Empty>No simulation rounds. The seed makes Round 4 the Startup Ecosystem simulation.</Empty>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {rounds.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-3">
                <span className="font-medium text-ink">{r.name} <span className="text-sm text-muted">· {r.economy ? `${r.economy.status.toLowerCase()}, cycle ${r.economy.currentCycle}` : "not set up"}</span></span>
                <Link href={`/admin/simulation/${r.id}`} className={`${cls.btn} ${cls.secondary}`}>Open</Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
