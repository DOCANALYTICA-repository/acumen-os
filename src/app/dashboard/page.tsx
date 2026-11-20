import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getContent, registrationOpen } from "@/lib/content";
import { computeLeaderboard } from "@/lib/scoring";
import { effectiveStatus, entryBlocker, teamStatus, TEAM_STATUS_LABEL, TYPE_LABEL } from "@/lib/rounds";
import { fileUrl } from "@/lib/files";
import { leaveTeam, regenerateInvite, removeMember, transferLead } from "@/app/actions/team";
import { Alert, Badge, Card, Container, PageHeader, cls, fmtDate, statusTone } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { CopyButton, CreateTeamForm, JoinTeamForm, PaymentForm, RenameTeamForm } from "./team-forms";

export const metadata = { title: "Dashboard · Acumen" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const user = await requireUser();
  if (user.role === "ADMIN") redirect("/admin");
  if (user.role === "JUDGE") redirect("/judge");
  const { code } = await searchParams;
  const content = await getContent();
  const team = user.membership?.team;

  if (!team) {
    return (
      <Container className="py-10">
        <PageHeader title={`Hi ${user.fullName.split(" ")[0]}`} subtitle="Step 2 of 3: create a team or join one with an invite code." />
        <div className="grid gap-6 md:grid-cols-2">
          <Card title="Create a team">
            <p className="mb-4 text-sm text-muted">You become the team lead and get an invite code to share.</p>
            <CreateTeamForm />
          </Card>
          <Card title="Join a team">
            <p className="mb-4 text-sm text-muted">Ask your team lead for the 6-character invite code.</p>
            <JoinTeamForm code={code} />
          </Card>
        </div>
      </Container>
    );
  }

  const isLead = user.membership!.isLead;
  const locked = !registrationOpen(content);
  const status = teamStatus(team, team.members.length, content.teamMin);
  const host = (await headers()).get("host");
  const inviteLink = `http://${host}/dashboard?code=${team.inviteCode}`;

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
        subtitle={<>Team {isLead ? "lead" : "member"} · <Badge tone={statusTone(status)}>{TEAM_STATUS_LABEL[status]}</Badge></>}
      />

      {status === "INCOMPLETE" && (
        <div className="mb-6"><Alert tone="amber">Your team needs at least {content.teamMin} members. Share the invite code below.</Alert></div>
      )}
      {status === "PAYMENT_REJECTED" && (
        <div className="mb-6"><Alert tone="red">The organizers rejected your payment proof. The team lead should upload a new one.</Alert></div>
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
                <li key={m.id} className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 break-words">
                    <div className="text-sm font-medium text-ink">{m.user.fullName} {m.isLead && <Badge tone="brand">Lead</Badge>}</div>
                    <div className="text-xs text-muted">{m.user.email} · {m.user.college}</div>
                  </div>
                  {isLead && !m.isLead && !locked && (
                    <div className="flex gap-1">
                      <form action={transferLead}><input type="hidden" name="userId" value={m.userId} /><SubmitButton variant="secondary" className="px-2 py-1 text-xs" confirm={`Make ${m.user.fullName} the team lead?`}>Make lead</SubmitButton></form>
                      <form action={removeMember}><input type="hidden" name="userId" value={m.userId} /><SubmitButton variant="danger" className="px-2 py-1 text-xs" confirm={`Remove ${m.user.fullName}?`}>Remove</SubmitButton></form>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">{team.members.length} of {content.teamMax} members{locked ? " · roster locked" : ""}</p>

            {!locked && (
              <div className="mt-5 rounded-lg bg-surface p-3">
                <div className="text-xs font-medium text-muted">Invite code</div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="font-mono text-xl font-bold tracking-widest text-ink">{team.inviteCode}</span>
                  <div className="flex gap-1">
                    <CopyButton text={team.inviteCode} />
                    <CopyButton text={inviteLink} label="Copy link" />
                  </div>
                </div>
                {isLead && (
                  <form action={regenerateInvite} className="mt-2">
                    <SubmitButton variant="secondary" className="px-2 py-1 text-xs" confirm="The old code will stop working. Continue?">New code</SubmitButton>
                  </form>
                )}
              </div>
            )}

            {isLead && !locked && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-brand">Rename team</summary>
                <div className="mt-3"><RenameTeamForm current={team.name} /></div>
              </details>
            )}
            {!locked && (isLead ? team.members.length === 1 : true) && (
              <form action={leaveTeam} className="mt-4">
                <SubmitButton variant="secondary" className="text-xs" confirm={isLead ? "This deletes your team. Continue?" : "Leave this team?"}>{isLead ? "Delete team" : "Leave team"}</SubmitButton>
              </form>
            )}
          </Card>

          <Card title="Payment">
            {team.paymentStatus === "PAID" ? (
              <div className="space-y-2 text-sm">
                <Badge tone="green">Paid</Badge>
                <p className="text-muted">Transaction ID: <span className="font-mono text-ink">{team.transactionId}</span></p>
                {team.paymentScreenshot && <a href={fileUrl(team.paymentScreenshot)} target="_blank" className={cls.ghost}>View uploaded proof</a>}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-lg bg-surface p-3 text-sm">
                  <div className="font-medium text-ink">Fee: {content.fee}</div>
                  <p className="mt-1 whitespace-pre-line text-muted">{content.paymentInstructions}</p>
                </div>
                {status === "INCOMPLETE" ? (
                  <p className="text-sm text-muted">Payment opens once your team has {content.teamMin} members.</p>
                ) : isLead ? (
                  <PaymentForm />
                ) : (
                  <p className="text-sm text-muted">Your team lead uploads the payment proof.</p>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </Container>
  );
}
