import Link from "next/link";
import { db } from "@/lib/db";
import { getContent } from "@/lib/content";
import { effectiveStatus, teamStatus } from "@/lib/rounds";
import { Badge, Card, PageHeader, Stat, cls, fmtDate, statusTone } from "@/components/ui";

export const metadata = { title: "Admin · Acumen" };

export default async function AdminHome() {
  const [content, users, teams, rounds, assignments, scores, logs] = await Promise.all([
    getContent(),
    db.user.count({ where: { role: "PARTICIPANT" } }),
    db.team.findMany({ include: { _count: { select: { members: true } } } }),
    db.round.findMany({ orderBy: { order: "asc" }, include: { _count: { select: { attempts: true, submissions: true } } } }),
    db.judgeAssignment.findMany(),
    db.score.findMany({ select: { roundId: true, teamId: true, judgeId: true } }),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  const statuses = teams.map((t) => teamStatus(t, t._count.members, content.teamMin));
  const today = new Date(Date.now() - 86_400_000);
  const newToday = await db.user.count({ where: { role: "PARTICIPANT", createdAt: { gte: today } } });
  const pendingJudging = assignments.filter((a) => !scores.some((x) => x.roundId === a.roundId && x.teamId === a.teamId && x.judgeId === a.judgeId)).length;

  const txns = teams.map((t) => t.transactionId).filter(Boolean);
  const dupTxns = txns.filter((t, i) => txns.indexOf(t) !== i).length;
  const flagged = await db.attempt.count({ where: { tabSwitches: { gte: 3 } } });

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Today at a glance" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Participants" value={users} hint={`+${newToday} in the last 24 h`} />
        <Stat label="Teams" value={teams.length} hint={`${statuses.filter((s) => s === "INCOMPLETE").length} incomplete`} />
        <Stat label="Paid teams" value={statuses.filter((s) => s === "PAID").length} hint={`${statuses.filter((s) => s === "COMPLETE").length} awaiting payment`} />
        <Stat label="Pending judging" value={pendingJudging} hint="assignments without scores" />
      </div>

      {(dupTxns > 0 || flagged > 0) && (
        <Card title="Alerts" className="mt-6">
          <ul className="space-y-1 text-sm">
            {dupTxns > 0 && <li>⚠️ {dupTxns} duplicate transaction ID(s). <Link href="/admin/teams?filter=dup" className={cls.ghost}>Review</Link></li>}
            {flagged > 0 && <li>⚠️ {flagged} attempt(s) with 3+ tab switches. <Link href="/admin/results" className={cls.ghost}>Review</Link></li>}
          </ul>
        </Card>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card title="Rounds">
          <table className="w-full">
            <thead><tr><th className={cls.th}>Round</th><th className={cls.th}>Status</th><th className={cls.th}>Entries</th></tr></thead>
            <tbody>
              {rounds.map((r) => {
                const st = effectiveStatus(r);
                return (
                  <tr key={r.id} className="border-t border-line">
                    <td className={cls.td}><Link href={`/admin/rounds/${r.id}`} className="font-medium text-ink hover:text-brand">{r.name}</Link></td>
                    <td className={cls.td}><Badge tone={statusTone(st)}>{st.toLowerCase()}</Badge></td>
                    <td className={cls.td}>{r.type === "SUBMISSION" ? r._count.submissions : r._count.attempts}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card title="Recent activity">
          <ul className="space-y-2 text-sm">
            {logs.map((l) => (
              <li key={l.id} className="flex justify-between gap-3">
                <span className="text-ink">{l.action} <span className="text-muted">{l.detail}</span></span>
                <span className="whitespace-nowrap text-xs text-muted">{fmtDate(l.createdAt)}</span>
              </li>
            ))}
            {logs.length === 0 && <li className="text-muted">No activity yet.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
