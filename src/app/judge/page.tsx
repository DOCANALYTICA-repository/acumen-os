import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { submissionSettings } from "@/lib/rounds";
import { Badge, Card, Container, Empty, PageHeader, cls } from "@/components/ui";

export const metadata = { title: "Judging · Acumen" };

export default async function JudgeHome() {
  const judge = await requireRole("JUDGE", "ADMIN");
  const [assignments, scores] = await Promise.all([
    db.judgeAssignment.findMany({ where: { judgeId: judge.id }, include: { round: true, team: true }, orderBy: [{ round: { order: "asc" } }] }),
    db.score.findMany({ where: { judgeId: judge.id }, select: { roundId: true, teamId: true } }),
  ]);
  const byRound = new Map<string, typeof assignments>();
  for (const a of assignments) byRound.set(a.roundId, [...(byRound.get(a.roundId) ?? []), a]);
  const done = (a: (typeof assignments)[number]) => scores.some((s) => s.roundId === a.roundId && s.teamId === a.teamId);

  return (
    <Container className="py-10">
      <PageHeader title="Judging" subtitle={`${assignments.filter(done).length} of ${assignments.length} scored`} />
      {assignments.length === 0 ? <Empty>No submissions assigned to you yet.</Empty> : (
        <div className="space-y-6">
          {[...byRound.values()].map((list) => {
            const round = list[0].round;
            const anon = submissionSettings(round).anonymousJudging && judge.role === "JUDGE";
            return (
              <Card key={round.id} title={round.name}>
                <ul className="divide-y divide-line">
                  {list.map((a) => (
                    <li key={a.id} className="flex items-center justify-between py-3">
                      <span className="text-sm font-medium text-ink">{anon ? `Submission ${a.teamId.slice(-5).toUpperCase()}` : a.team.name}</span>
                      <span className="flex items-center gap-2">
                        <Badge tone={done(a) ? "green" : "amber"}>{done(a) ? "Scored" : "Pending"}</Badge>
                        <Link href={`/judge/${a.roundId}/${a.teamId}`} className={`${cls.btn} ${cls.secondary} px-3 py-1.5`}>{done(a) ? "Edit" : "Score"}</Link>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
    </Container>
  );
}
