import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { db, parseJson } from "@/lib/db";
import { submissionSettings } from "@/lib/rounds";
import { fileUrl, formatBytes, type StoredFile } from "@/lib/files";
import { saveScores } from "@/app/actions/judge";
import { Badge, Card, Container, Empty, Field, PageHeader, cls, fmtDate } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

export default async function ScorePage({ params }: { params: Promise<{ roundId: string; teamId: string }> }) {
  const { roundId, teamId } = await params;
  const judge = await requireRole("JUDGE", "ADMIN");
  if (judge.role === "JUDGE" && !(await db.judgeAssignment.findFirst({ where: { roundId, teamId, judgeId: judge.id } }))) redirect("/judge");
  const [round, team, sub, existing] = await Promise.all([
    db.round.findUnique({ where: { id: roundId }, include: { criteria: true } }),
    db.team.findUnique({ where: { id: teamId } }),
    db.submission.findFirst({ where: { roundId, teamId }, orderBy: { version: "desc" } }),
    db.score.findMany({ where: { roundId, teamId, judgeId: judge.id } }),
  ]);
  if (!round || !team) notFound();
  const anon = submissionSettings(round).anonymousJudging && judge.role === "JUDGE";
  const files = parseJson<StoredFile[]>(sub?.files, []);
  const firstPdf = files.find((f) => f.name.toLowerCase().endsWith(".pdf"));
  const back = judge.role === "ADMIN" ? `/admin/submissions?round=${roundId}` : "/judge";

  return (
    <Container className="py-10">
      <PageHeader
        title={anon ? `Submission ${teamId.slice(-5).toUpperCase()}` : team.name}
        subtitle={round.name}
        actions={<Link href={back} className={`${cls.btn} ${cls.secondary}`}>Back</Link>}
      />
      {!sub ? <Empty>This team has not submitted yet.</Empty> : (
        <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-4">
            <Card title={sub.title || "Untitled"}>
              <div className="mb-2 text-xs text-muted">Version {sub.version} · {fmtDate(sub.submittedAt)} {sub.isLate && <Badge tone="red">Late</Badge>}</div>
              {sub.summary && <p className="mb-3 whitespace-pre-line text-sm text-ink/80">{sub.summary}</p>}
              <ul className="space-y-1 text-sm">
                {files.map((f) => <li key={f.path}><a href={fileUrl(f.path)} target="_blank" className={cls.ghost}>{f.name}</a> <span className="text-xs text-muted">{formatBytes(f.size)}</span></li>)}
                {parseJson<string[]>(sub.links, []).map((l) => <li key={l}><a href={l} target="_blank" rel="noreferrer" className={cls.ghost}>{l}</a></li>)}
              </ul>
            </Card>
            {firstPdf && <iframe src={fileUrl(firstPdf.path)} className="h-[70vh] w-full rounded-xl border border-line bg-white" title="Preview" />}
          </div>
          <Card title="Score">
            <form action={saveScores} className="space-y-4">
              <input type="hidden" name="roundId" value={roundId} />
              <input type="hidden" name="teamId" value={teamId} />
              {round.criteria.map((c) => (
                <Field key={c.id} label={`${c.name} (max ${c.maxMarks})`}>
                  <input type="number" name={`c_${c.id}`} min={0} max={c.maxMarks} step="0.5" required defaultValue={existing.find((e) => e.criterionId === c.id)?.marks ?? ""} className={cls.input} />
                </Field>
              ))}
              <Field label="Comments (optional)">
                <textarea name="comment" rows={4} defaultValue={existing[0]?.comment ?? ""} className={cls.input} />
              </Field>
              <SubmitButton>Save score</SubmitButton>
            </form>
          </Card>
        </div>
      )}
    </Container>
  );
}
