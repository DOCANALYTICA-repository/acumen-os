import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getContent, registrationOpen } from "@/lib/content";
import { computeLeaderboard } from "@/lib/scoring";
import { effectiveStatus, entryBlocker, teamStatus, TEAM_STATUS_LABEL, TYPE_LABEL } from "@/lib/rounds";
import { fileUrl } from "@/lib/files";
import { Alert, Badge, Card, Container, PageHeader, cls, fmtDate, statusTone } from "@/components/ui";
import { ReceiptForm, RenameTeamForm } from "./team-forms";

export const metadata = { title: "Dashboard · Acumen" };

export default async function Dashboard() {
  const user = await requireUser();
  if (user.role === "ADMIN") redirect("/admin");
  if (user.role === "JUDGE") redirect("/judge");
  const content = await getContent();
  const team = user.membership?.team;

  if (!team) {
    // Accounts are only created with a team now; this covers anything left over from older test data.
    return (
      <Container className="py-10">
        <PageHeader title={`Hi ${user.fullName.split(" ")[0]}`} />
        <Alert tone="amber">This account isn&apos;t part of a team. Teams register together: <Link href="/register" className={cls.ghost}>register a team</Link> (log out first), or contact the organisers.</Alert>
      </Container>
    );
  }

  const isLead = user.membership!.isLead;
  const locked = !registrationOpen(content);
  const status = teamStatus(team, team.members.length);

  const [rounds, attempts, submissions, qualifications] = await Promise.all([
    db.round.findMany({ where: { status: { not: "DRAFT" } }, orderBy: { order: "asc" } }),
    db.attempt.findMany({ where: { teamId: team.id } }),
    db.submission.findMany({ where: { teamId: team.id }, orderBy: { version: "desc" } }),
    db.qualification.findMany({ where: { teamId: team.id } }),
  ]);
  const published = rounds.filter((r) => r.resultsPublished);
  const board = published.length ? await computeLeaderboard() : null;
  const myRow = board?.rows.find((r) => r.teamId === team.id);

  return (
    <Container className="py-10">
      <PageHeader
        title={team.name}
        subtitle={<>{isLead ? "Captain" : "Member"} · <Badge tone={statusTone(status)}>{TEAM_STATUS_LABEL[status]}</Badge></>}
      />

      {status === "PAYMENT_REJECTED" && (
        <div className="mb-6"><Alert tone="red">The organisers rejected your payment receipt, so rounds are locked. Attach a new receipt under Payment.</Alert></div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Rounds">
            <div className="divide-y divide-line">
              {rounds.map((r) => {
                const st = effectiveStatus(r);
                const qualified = qualifications.some((q) => q.roundId === r.id);
                const blocker = entryBlocker({ round: r, status, qualified });
                const attempt = attempts.find((a) => a.roundId === r.id);
                const sub = submissions.find((s) => s.roundId === r.id);
                const done = attempt?.submittedAt || sub;
                return (
                  <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <div>
                      <div className="font-medium text-ink">{r.name}</div>
                      <div className="text-xs text-muted">
                        {TYPE_LABEL[r.type]} · {r.startsAt ? `${fmtDate(r.startsAt)} – ${fmtDate(r.endsAt)}` : "Dates TBA"}
                      </div>
                      {blocker && st === "LIVE" && <div className="mt-1 text-xs text-amber-700">{blocker}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      {done && <Badge tone="green">{r.type === "SUBMISSION" ? `Submitted v${sub?.version}` : r.type === "MANUAL" ? "Marked done" : r.type === "QUIZ" ? "Played" : "Submitted"}</Badge>}
                      <Badge tone={statusTone(st)}>{st.toLowerCase()}</Badge>
                      <Link href={`/rounds/${r.id}`} className={`${cls.btn} ${cls.secondary} px-3 py-1.5`}>Open</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {published.length > 0 && myRow && (
            <Card title="Results">
              <table className="w-full">
                <thead><tr><th className={cls.th}>Round</th><th className={cls.th}>Score</th></tr></thead>
                <tbody>
                  {published.map((r) => (
                    <tr key={r.id} className="border-t border-line">
                      <td className={cls.td}>{r.name}</td>
                      <td className={cls.td}>{myRow.perRound[r.id] === null ? "—" : `${myRow.perRound[r.id]!.toFixed(1)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-sm text-muted">Overall rank so far: <strong className="text-ink">#{myRow.rank}</strong> of {board!.rows.length}</p>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card title="Team">
            <ul className="space-y-3">
              {team.members.map((m) => (
                <li key={m.id} className="min-w-0 break-words">
                  <div className="text-sm font-medium text-ink">{m.user.fullName} {m.isLead && <Badge tone="brand">Captain</Badge>}</div>
                  <div className="text-xs text-muted">{m.user.email} · {m.user.college}</div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">The team logs in with the captain&apos;s email. To change a member, contact the organisers.</p>
            {isLead && !locked && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-brand">Rename team</summary>
                <div className="mt-3"><RenameTeamForm current={team.name} /></div>
              </details>
            )}
          </Card>

          <Card title="Payment">
            <div className="space-y-3 text-sm">
              <Badge tone={team.paymentStatus === "REJECTED" ? "red" : "green"}>{team.paymentStatus === "REJECTED" ? "Receipt rejected" : "Receipt received"}</Badge>
              {team.transactionId && <p className="text-muted">Reference: <span className="font-mono text-ink">{team.transactionId}</span></p>}
              {team.paymentScreenshot && <p><a href={fileUrl(team.paymentScreenshot)} target="_blank" className={cls.ghost}>View your receipt</a></p>}
              {team.paymentStatus === "REJECTED" && (isLead ? <ReceiptForm /> : <p className="text-muted">Your captain needs to attach a new receipt.</p>)}
            </div>
          </Card>
        </div>
      </div>
    </Container>
  );
}
