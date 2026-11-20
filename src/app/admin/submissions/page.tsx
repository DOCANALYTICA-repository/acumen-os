import Link from "next/link";
import { db, parseJson } from "@/lib/db";
import { assignJudge, autoAssign, setOverride, unassignJudge } from "@/app/actions/admin";
import { Badge, Card, Empty, PageHeader, cls, fmtDate } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export default async function AdminSubmissions({ searchParams }: { searchParams: Promise<{ round?: string }> }) {
  const rounds = await db.round.findMany({ where: { type: "SUBMISSION" }, orderBy: { order: "asc" }, include: { criteria: true } });
  const { round: roundParam } = await searchParams;
  const round = rounds.find((r) => r.id === roundParam) ?? rounds[0];
  if (!round) return <Empty>No submission rounds.</Empty>;

  const [subs, judges, assignments, scores, overrides] = await Promise.all([
    db.submission.findMany({ where: { roundId: round.id }, include: { team: true, uploadedBy: true }, orderBy: { version: "desc" } }),
    db.user.findMany({ where: { role: "JUDGE" }, orderBy: { fullName: "asc" } }),
    db.judgeAssignment.findMany({ where: { roundId: round.id }, include: { judge: true } }),
    db.score.findMany({ where: { roundId: round.id } }),
    db.resultOverride.findMany({ where: { roundId: round.id } }),
  ]);
  const maxMarks = round.criteria.reduce((s, c) => s + c.maxMarks, 0);
  // subs are ordered by version desc, so the first one seen per team is its latest
  const firstPerTeam = new Map<string, (typeof subs)[number]>();
  for (const s of subs) if (!firstPerTeam.has(s.teamId)) firstPerTeam.set(s.teamId, s);
  const rows = [...firstPerTeam.values()];
  const judgeTotal = (teamId: string, judgeId: string) => scores.filter((x) => x.teamId === teamId && x.judgeId === judgeId).reduce((a, b) => a + b.marks, 0);

  return (
    <>
      <PageHeader title="Submissions & judging" subtitle={`${rows.length} teams submitted · ${judges.length} judges`} />
      <div className="mb-4 flex flex-wrap gap-2">
        {rounds.map((r) => (
          <Link key={r.id} href={`/admin/submissions?round=${r.id}`} className={`rounded-full px-3 py-1 text-xs font-medium ${r.id === round.id ? "bg-brand text-white" : "border border-line bg-white text-ink"}`}>{r.name}</Link>
        ))}
      </div>

      <Card className="mb-6" title="Auto-assign judges">
        <form action={autoAssign} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="roundId" value={round.id} />
          <label className="text-sm">Judges per submission <input type="number" name="perTeam" min={1} defaultValue={2} className={`${cls.input} ml-2 w-20`} /></label>
          <SubmitButton variant="secondary">Assign round-robin</SubmitButton>
          <a href={`/api/admin/export/submissions?round=${round.id}`} className={`${cls.btn} ${cls.secondary}`}>Export CSV</a>
        </form>
        {judges.length === 0 && <p className="mt-2 text-xs text-amber-700">No judges yet — add them under Content & settings → Staff accounts.</p>}
      </Card>

      {rows.length === 0 ? <Empty>No submissions yet for this round.</Empty> : (
        <div className="space-y-4">
          {rows.map((s) => {
            const mine = assignments.filter((a) => a.teamId === s.teamId);
            const scored = mine.filter((a) => scores.some((x) => x.teamId === s.teamId && x.judgeId === a.judgeId));
            const avg = scored.length ? scored.reduce((sum, a) => sum + judgeTotal(s.teamId, a.judgeId), 0) / scored.length : null;
            const totals = scored.map((a) => judgeTotal(s.teamId, a.judgeId));
            const spread = totals.length > 1 && maxMarks ? ((Math.max(...totals) - Math.min(...totals)) / maxMarks) * 100 : 0;
            const ov = overrides.find((o) => o.teamId === s.teamId);
            return (
              <Card key={s.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2"><h3 className="font-semibold text-ink">{s.team.name}</h3><Badge>v{s.version}</Badge>{s.isLate && <Badge tone="red">Late</Badge>}</div>
                    <div className="text-xs text-muted">{s.title || "Untitled"} · by {s.uploadedBy.fullName} · {fmtDate(s.submittedAt)}</div>
                    <ul className="mt-2 space-y-1 text-sm">
                      {parseJson<string[]>(s.links, []).map((l) => <li key={l}><a href={l} target="_blank" rel="noreferrer" className={`${cls.ghost} break-all`}>{l}</a></li>)}
                    </ul>
                  </div>
                  <div className="text-right text-sm">
                    <div className="text-xs text-muted">Average</div>
                    <div className="text-xl font-bold text-ink">{avg === null ? "—" : `${avg.toFixed(1)} / ${maxMarks}`}</div>
                    {spread > 20 && <Badge tone="amber">Judges differ by {spread.toFixed(0)}%</Badge>}
                    {ov && <div className="mt-1"><Badge tone="blue">Override {ov.score}%</Badge></div>}
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <span className="text-xs font-medium text-muted">Judges:</span>
                  {mine.map((a) => {
                    const done = scores.some((x) => x.teamId === s.teamId && x.judgeId === a.judgeId);
                    return (
                      <form key={a.id} action={unassignJudge} className="flex items-center gap-1 rounded-full bg-surface px-2 py-1 text-xs">
                        <input type="hidden" name="id" value={a.id} />
                        {a.judge.fullName} {done ? `· ${judgeTotal(s.teamId, a.judgeId)}` : "· pending"}
                        <button className="ml-1 text-muted hover:text-red-600" title="Unassign">×</button>
                      </form>
                    );
                  })}
                  <form action={assignJudge} className="flex items-center gap-1">
                    <input type="hidden" name="roundId" value={round.id} />
                    <input type="hidden" name="teamId" value={s.teamId} />
                    <select name="judgeId" className={`${cls.input} w-40 py-1 text-xs`} defaultValue="">
                      <option value="">Add judge…</option>
                      {judges.filter((j) => !mine.some((a) => a.judgeId === j.id)).map((j) => <option key={j.id} value={j.id}>{j.fullName}</option>)}
                    </select>
                    <SubmitButton variant="secondary" className="px-2 py-1 text-xs">Add</SubmitButton>
                  </form>
                  <Link href={`/judge/${round.id}/${s.teamId}`} className="text-xs font-medium text-brand hover:underline">Score as admin</Link>
                  <form action={setOverride} className="ml-auto flex items-center gap-1">
                    <input type="hidden" name="roundId" value={round.id} />
                    <input type="hidden" name="teamId" value={s.teamId} />
                    <input name="score" type="number" min={0} max={100} step="0.1" defaultValue={ov?.score ?? ""} placeholder="Override %" className={`${cls.input} w-28 py-1 text-xs`} />
                    <SubmitButton variant="secondary" className="px-2 py-1 text-xs">Set</SubmitButton>
                  </form>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
