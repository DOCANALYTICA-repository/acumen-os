import { db, parseJson } from "@/lib/db";
import { excelKey, teamStatus } from "@/lib/rounds";
import { computeLeaderboard, excelItemCorrect, isQuizAnswerCorrect, type QuizAnswer } from "@/lib/scoring";
import { Card, PageHeader, Stat, cls, DownloadLink } from "@/components/ui";
import { Bars, Funnel, GroupedBars, Trend } from "./charts";

function countBy<T>(items: T[], key: (t: T) => string | null | undefined, top = 8) {
  const m = new Map<string, number>();
  for (const i of items) {
    const k = key(i) || "Not given";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([name, count]) => ({ name, count }));
}

const day = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

export default async function Analytics() {
  const [users, teams, rounds, attempts, submissions, assignments, scores] = await Promise.all([
    db.user.findMany({ where: { role: "PARTICIPANT" }, include: { membership: true } }),
    db.team.findMany({ include: { _count: { select: { members: true } } } }),
    db.round.findMany({ orderBy: { order: "asc" }, include: { questions: { orderBy: { order: "asc" } } } }),
    db.attempt.findMany(),
    db.submission.findMany({ select: { roundId: true, teamId: true, isLate: true } }),
    db.judgeAssignment.findMany(),
    db.score.findMany({ select: { roundId: true, teamId: true, judgeId: true } }),
  ]);
  const { rows } = await computeLeaderboard();

  // ---- registrations ----
  const statuses = teams.map((t) => teamStatus(t, t._count.members));
  const paidTeams = statuses.filter((s) => s === "PAID").length;
  const dates = users.map((u) => day(u.createdAt)).sort();
  const daily: { date: string; signups: number; total: number }[] = [];
  if (dates.length) {
    let cur = new Date(dates[0]);
    const end = new Date(day(new Date()));
    let total = 0;
    while (cur <= end) {
      const d = cur.toISOString().slice(0, 10);
      const c = dates.filter((x) => x === d).length;
      total += c;
      daily.push({ date: d.slice(5), signups: c, total });
      cur = new Date(cur.getTime() + 86_400_000);
    }
  }
  const inTeam = users.filter((u) => u.membership).length;
  const completeTeamsMembers = teams.filter((t, i) => statuses[i] !== "INCOMPLETE").reduce((s, t) => s + t._count.members, 0);
  const paidMembers = teams.filter((_, i) => statuses[i] === "PAID").reduce((s, t) => s + t._count.members, 0);
  const funnel = [
    { stage: "Signed up", count: users.length },
    { stage: "Joined a team", count: inTeam },
    { stage: "In a complete team", count: completeTeamsMembers },
    { stage: "In a paid team", count: paidMembers },
  ];

  // ---- performance ----
  const eligible = paidTeams;
  const participation = rounds.map((r) => {
    const entered = r.type === "SUBMISSION" ? new Set(submissions.filter((s) => s.roundId === r.id).map((s) => s.teamId)).size : attempts.filter((a) => a.roundId === r.id).length;
    const completed = r.type === "SUBMISSION"
      ? new Set(scores.filter((s) => s.roundId === r.id).map((s) => s.teamId)).size
      : attempts.filter((a) => a.roundId === r.id && a.submittedAt).length;
    return { round: `R${r.order}`, eligible, entered, completed };
  });

  const histograms = rounds.map((r) => {
    const buckets = Array.from({ length: 10 }, (_, i) => ({ range: `${i * 10}–${i * 10 + 10}`, teams: 0 }));
    for (const row of rows) {
      const v = row.perRound[r.id];
      if (v === null) continue;
      buckets[Math.min(9, Math.floor(v / 10))].teams++;
    }
    return { round: r, buckets, n: rows.filter((x) => x.perRound[r.id] !== null).length };
  }).filter((h) => h.n > 0);

  const quiz = rounds.find((r) => r.type === "QUIZ");
  const quizAttempts = attempts.filter((a) => a.roundId === quiz?.id && a.submittedAt);
  const answered = quizAttempts.filter((a) => Object.keys(parseJson<object>(a.answers, {})).length > 0);
  const questionAccuracy = quiz && answered.length
    ? quiz.questions.map((q, i) => ({
        q: `Q${i + 1}`,
        correct: Math.round((answered.filter((a) => isQuizAnswerCorrect(q, parseJson<Record<string, QuizAnswer>>(a.answers, {})[q.id])).length / answered.length) * 100),
      }))
    : [];

  const excel = rounds.find((r) => r.type === "EXCEL");
  const excelAttempts = attempts.filter((a) => a.roundId === excel?.id && a.submittedAt && Object.keys(parseJson<object>(a.answers, {})).length > 0);
  const cellAccuracy = excel && excelAttempts.length
    ? excelKey(excel).map((k) => ({
        cell: k.cell.replace(/^.*!/, ""),
        correct: Math.round((excelAttempts.filter((a) => excelItemCorrect(k, parseJson<Record<string, string>>(a.answers, {})[k.cell])).length / excelAttempts.length) * 100),
      }))
    : [];

  const judged = assignments.filter((a) => scores.some((s) => s.roundId === a.roundId && s.teamId === a.teamId && s.judgeId === a.judgeId)).length;

  return (
    <>
      <PageHeader title="Analytics" subtitle="Registrations and team performance, live from the database" actions={<DownloadLink href="/api/admin/export/leaderboard">Export leaderboard</DownloadLink>} />

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Registrations</h2>
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-3">
        <Stat label="Participants" value={users.length} />
        <Stat label="Teams" value={teams.length} hint={`${statuses.filter((s) => s !== "INCOMPLETE").length} complete · ${statuses.filter((s) => s === "INCOMPLETE").length} incomplete`} />
        <Stat label="Paid teams" value={paidTeams} hint={`${teams.length - paidTeams} unpaid or other`} />
      </div>
      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card title="Cumulative sign-ups"><Trend data={daily} x="date" y="total" label="Participants" /></Card>
        <Card title="Sign-ups per day"><Bars data={daily} x="date" y="signups" label="Sign-ups" /></Card>
        <Card title="Registration funnel (people)"><Funnel stages={funnel} /></Card>
        <Card title="Top colleges"><Bars data={countBy(users, (u) => u.college)} x="name" y="count" label="Participants" horizontal /></Card>
        <Card title="Top cities"><Bars data={countBy(users, (u) => u.city)} x="name" y="count" label="Participants" horizontal /></Card>
        <Card title="How they heard about Acumen"><Bars data={countBy(users, (u) => u.source)} x="name" y="count" label="Participants" horizontal /></Card>
      </div>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted">Team performance</h2>
      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card title="Participation per round">
          <GroupedBars data={participation} x="round" series={[{ key: "eligible", label: "Paid teams" }, { key: "entered", label: "Entered" }, { key: "completed", label: "Submitted / scored" }]} />
        </Card>
        <Card title="Judging progress">
          <div className="py-6 text-center">
            <div className="text-4xl font-bold text-ink">{judged} / {assignments.length}</div>
            <div className="mt-1 text-sm text-muted">judge assignments scored</div>
            <div className="mx-auto mt-4 h-3 max-w-sm rounded-full bg-surface"><div className="h-3 rounded-full bg-[#2a78d6]" style={{ width: `${assignments.length ? (judged / assignments.length) * 100 : 0}%` }} /></div>
            <div className="mt-4 text-xs text-muted">{submissions.filter((s) => s.isLate).length} late submission version(s)</div>
          </div>
        </Card>
        {histograms.map((h) => (
          <Card key={h.round.id} title={`${h.round.name} — score distribution (${h.n} teams)`}>
            <Bars data={h.buckets} x="range" y="teams" label="Teams" height={200} />
          </Card>
        ))}
        {questionAccuracy.length > 0 && <Card title={`Quiz: % of teams correct per question (${answered.length} teams)`}><Bars data={questionAccuracy} x="q" y="correct" label="% correct" /></Card>}
        {cellAccuracy.length > 0 && <Card title={`Excel: % of teams correct per answer cell (${excelAttempts.length} teams)`}><Bars data={cellAccuracy} x="cell" y="correct" label="% correct" /></Card>}
      </div>

      <Card title="Top 10 overall">
        <table className="w-full">
          <thead><tr><th className={cls.th}>Rank</th><th className={cls.th}>Team</th><th className={cls.th}>College</th><th className={cls.th}>Overall</th></tr></thead>
          <tbody>{rows.slice(0, 10).map((r) => <tr key={r.teamId} className="border-t border-line"><td className={cls.td}>{r.rank}</td><td className={cls.td}>{r.teamName}</td><td className={`${cls.td} text-xs text-muted`}>{r.college}</td><td className={`${cls.td} tabular-nums`}>{r.overall.toFixed(1)}</td></tr>)}</tbody>
        </table>
      </Card>
    </>
  );
}
