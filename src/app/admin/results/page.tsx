import { db } from "@/lib/db";
import { computeLeaderboard } from "@/lib/scoring";
import { clearQualification, qualifyTopN, setPublished } from "@/app/actions/admin";
import { Badge, Card, PageHeader, cls, DownloadLink } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export default async function AdminResults() {
  const { rounds, rows } = await computeLeaderboard();
  const [quals, flagged] = await Promise.all([
    db.qualification.findMany(),
    db.attempt.findMany({ where: { tabSwitches: { gte: 3 } }, include: { team: true, round: true } }),
  ]);
  const totalWeight = rounds.reduce((s, r) => s + r.weight, 0);

  return (
    <>
      <PageHeader title="Results & leaderboard" subtitle={`Overall = weighted average of round percentages (weights: ${rounds.map((r) => r.weight).join(" / ")}, total ${totalWeight})`} actions={<DownloadLink href="/api/admin/export/leaderboard">Export CSV</DownloadLink>} />

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rounds.map((r, i) => {
          const qualified = quals.filter((q) => q.roundId === r.id).length;
          return (
            <Card key={r.id} title={r.name}>
              <form action={setPublished} className="mb-3 flex items-center justify-between gap-2">
                <input type="hidden" name="roundId" value={r.id} />
                <input type="hidden" name="publish" value={r.resultsPublished ? "0" : "1"} />
                <Badge tone={r.resultsPublished ? "green" : "gray"}>{r.resultsPublished ? "Results published" : "Results hidden"}</Badge>
                <SubmitButton variant="secondary" className="px-2 py-1 text-xs" confirm={r.resultsPublished ? "Hide results from teams?" : "Publish this round's scores to teams?"}>{r.resultsPublished ? "Unpublish" : "Publish"}</SubmitButton>
              </form>
              {i > 0 && (
                <div className="rounded-lg bg-surface p-3">
                  <div className="mb-2 text-xs font-medium text-muted">Cut-off into this round {r.restrictToQualified ? <Badge tone="blue">{qualified} qualified</Badge> : <Badge>open to all paid teams</Badge>}</div>
                  <form action={qualifyTopN} className="flex flex-wrap items-center gap-2 text-sm">
                    <input type="hidden" name="targetRoundId" value={r.id} />
                    Top <input type="number" name="count" min={1} defaultValue={qualified || 10} className={`${cls.input} w-16 py-1`} /> by
                    <select name="basis" className={`${cls.input} w-36 py-1`} defaultValue={rounds[i - 1].id}>
                      <option value="overall">overall so far</option>
                      {rounds.slice(0, i).map((p) => <option key={p.id} value={p.id}>{p.name.replace(/ — .*/, "")}</option>)}
                    </select>
                    <SubmitButton variant="secondary" className="px-2 py-1 text-xs" confirm="Replace the qualified list for this round?">Apply</SubmitButton>
                  </form>
                  {r.restrictToQualified && (
                    <form action={clearQualification} className="mt-2"><input type="hidden" name="targetRoundId" value={r.id} /><SubmitButton variant="secondary" className="px-2 py-1 text-xs">Open to all</SubmitButton></form>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Card title={`Leaderboard (${rows.length} teams)`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className={cls.th}>Rank</th><th className={cls.th}>Team</th><th className={cls.th}>College</th>
                {rounds.map((r) => <th key={r.id} className={cls.th}>R{r.order}</th>)}
                <th className={cls.th}>Overall</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.teamId} className="border-t border-line">
                  <td className={`${cls.td} font-semibold`}>{row.rank}</td>
                  <td className={cls.td}>{row.teamName}</td>
                  <td className={`${cls.td} text-xs text-muted`}>{row.college}</td>
                  {rounds.map((r) => {
                    const v = row.perRound[r.id];
                    const q = quals.some((x) => x.roundId === r.id && x.teamId === row.teamId);
                    return <td key={r.id} className={`${cls.td} tabular-nums`}>{v === null ? "—" : v.toFixed(1)}{r.restrictToQualified && q && <span title="Qualified" className="ml-1 text-emerald-600">●</span>}</td>;
                  })}
                  <td className={`${cls.td} font-semibold tabular-nums`}>{row.overall.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">Scores are percentages of each round&apos;s max. ● = qualified for that round. Disqualified teams are excluded.</p>
      </Card>

      {flagged.length > 0 && (
        <Card title="Integrity flags" className="mt-6">
          <table className="w-full">
            <thead><tr><th className={cls.th}>Team</th><th className={cls.th}>Round</th><th className={cls.th}>Tab switches</th></tr></thead>
            <tbody>{flagged.map((a) => <tr key={a.id} className="border-t border-line"><td className={cls.td}>{a.team.name}</td><td className={cls.td}>{a.round.name}</td><td className={cls.td}><Badge tone="red">{a.tabSwitches}</Badge></td></tr>)}</tbody>
          </table>
        </Card>
      )}
    </>
  );
}
