import Link from "next/link";
import { db } from "@/lib/db";
import { effectiveStatus, TYPE_LABEL } from "@/lib/rounds";
import { Badge, Card, PageHeader, cls, fmtDate, statusTone } from "@/components/ui";

export default async function AdminRounds() {
  const rounds = await db.round.findMany({ orderBy: { order: "asc" }, include: { _count: { select: { questions: true, attempts: true, submissions: true, criteria: true } } } });
  const totalWeight = rounds.reduce((s, r) => s + r.weight, 0);
  return (
    <>
      <PageHeader title="Rounds" subtitle={`5 rounds · leaderboard weights total ${totalWeight}`} />
      <Card>
        <table className="w-full">
          <thead>
            <tr><th className={cls.th}>#</th><th className={cls.th}>Round</th><th className={cls.th}>Type</th><th className={cls.th}>Window (IST)</th><th className={cls.th}>Weight</th><th className={cls.th}>Status</th><th className={cls.th}>Setup</th></tr>
          </thead>
          <tbody>
            {rounds.map((r) => {
              const st = effectiveStatus(r);
              const setup = r.type === "QUIZ" ? `${r._count.questions} questions` : r.type === "EXCEL" ? (r.excelTemplate ? "Workbook uploaded" : "No workbook") : r.type === "SIMULATION" ? "Economy in control room" : r.type === "MANUAL" ? `${r._count.attempts} marked done or scored` : `${r._count.criteria} rubric criteria`;
              return (
                <tr key={r.id} className="border-t border-line">
                  <td className={cls.td}>{r.order}</td>
                  <td className={cls.td}><Link href={`/admin/rounds/${r.id}`} className="font-medium text-brand hover:underline">{r.name}</Link></td>
                  <td className={cls.td}>{TYPE_LABEL[r.type]}</td>
                  <td className={`${cls.td} text-xs`}>{fmtDate(r.startsAt)}<br />{fmtDate(r.endsAt)}</td>
                  <td className={cls.td}>{r.weight}</td>
                  <td className={cls.td}><Badge tone={statusTone(st)}>{st.toLowerCase()}</Badge>{r.restrictToQualified && <div className="mt-1"><Badge tone="blue">qualified only</Badge></div>}</td>
                  <td className={`${cls.td} text-xs text-muted`}>{setup}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
