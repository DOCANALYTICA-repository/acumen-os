import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db, parseJson } from "@/lib/db";
import { getContent } from "@/lib/content";
import { effectiveStatus, entryBlocker, excelKey, submissionSettings, teamStatus, timeLeftMs, TYPE_LABEL } from "@/lib/rounds";
import { fileUrl, formatBytes, type StoredFile } from "@/lib/files";
import { finalizeIfExpired, startAttempt } from "@/app/actions/rounds";
import { Alert, Badge, Card, Container, PageHeader, cls, fmtDate, statusTone } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";
import { QuizClient, type ClientQuestion } from "./quiz-client";
import { ExcelClient } from "./excel-client";
import { SubmissionForm } from "./submission-form";

/** Deterministic shuffle so a team always sees the same order. */
function seededShuffle<T>(arr: T[], seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const j = Math.abs(h) % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export default async function RoundPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  if (user.role !== "PARTICIPANT") redirect(user.role === "ADMIN" ? `/admin/rounds/${id}` : "/judge");
  const round = await db.round.findUnique({ where: { id }, include: { questions: { orderBy: { order: "asc" } } } });
  if (!round || round.status === "DRAFT") notFound();
  const team = user.membership?.team;
  if (!team) redirect("/dashboard");

  await finalizeIfExpired(round.id, team.id);
  const content = await getContent();
  const st = effectiveStatus(round);
  const status = teamStatus(team, team.members.length, content.teamMin);
  const qualified = !!(await db.qualification.findUnique({ where: { roundId_teamId: { roundId: round.id, teamId: team.id } } }));
  const blocker = entryBlocker({ round, status, qualified });
  const attempt = await db.attempt.findUnique({ where: { roundId_teamId: { roundId: round.id, teamId: team.id } } });

  const header = (
    <PageHeader
      title={round.name}
      subtitle={<>{TYPE_LABEL[round.type]} · {round.startsAt ? `${fmtDate(round.startsAt)} – ${fmtDate(round.endsAt)}` : "Dates TBA"} · <Badge tone={statusTone(st)}>{st.toLowerCase()}</Badge></>}
      actions={<Link href="/dashboard" className={`${cls.btn} ${cls.secondary}`}>Back to dashboard</Link>}
    />
  );
  const brief = (
    <Card title="Instructions" className="mb-6">
      <p className="whitespace-pre-line text-sm text-ink/80">{round.description}</p>
      {round.instructions && <p className="mt-3 whitespace-pre-line text-sm text-ink/80">{round.instructions}</p>}
      {round.briefFile && <a href={fileUrl(round.briefFile)} className={`${cls.ghost} mt-3 inline-block text-sm`}>Download brief</a>}
    </Card>
  );

  // ---------- Submission rounds ----------
  if (round.type === "SUBMISSION") {
    const rules = submissionSettings(round);
    const history = await db.submission.findMany({ where: { roundId: round.id, teamId: team.id }, orderBy: { version: "desc" }, include: { uploadedBy: true } });
    const canSubmit = !blocker && (st === "LIVE" || (st === "CLOSED" && rules.allowLate)) && (rules.allowResubmit || history.length === 0);
    return (
      <Container className="py-10">
        {header}
        {brief}
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title={history.length ? "Replace your submission" : "Your submission"}>
            {blocker ? <Alert tone="amber">{blocker}</Alert>
              : st === "UPCOMING" ? <Alert tone="amber">Opens {fmtDate(round.startsAt)}.</Alert>
              : canSubmit ? <SubmissionForm roundId={round.id} accept={rules.allowedTypes} maxFiles={rules.maxFiles} maxSizeMB={rules.maxSizeMB} allowLinks={rules.allowLinks} late={st === "CLOSED"} />
              : <Alert tone="gray">Submissions for this round are closed.</Alert>}
          </Card>
          <Card title="Version history">
            {history.length === 0 ? <p className="text-sm text-muted">Nothing submitted yet.</p> : (
              <ul className="space-y-4">
                {history.map((s, i) => (
                  <li key={s.id} className="rounded-lg border border-line p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-ink">v{s.version} · {s.title || "Untitled"}</span>
                      <span className="flex gap-1">{i === 0 && <Badge tone="green">Counts</Badge>}{s.isLate && <Badge tone="red">Late</Badge>}</span>
                    </div>
                    <div className="mt-1 text-xs text-muted">By {s.uploadedBy.fullName} · {fmtDate(s.submittedAt)}</div>
                    <ul className="mt-2 space-y-1">
                      {parseJson<StoredFile[]>(s.files, []).map((f) => (
                        <li key={f.path}><a href={fileUrl(f.path)} target="_blank" className={`${cls.ghost} text-sm`}>{f.name}</a> <span className="text-xs text-muted">({formatBytes(f.size)})</span></li>
                      ))}
                      {parseJson<string[]>(s.links, []).map((l) => <li key={l}><a href={l} target="_blank" rel="noreferrer" className={`${cls.ghost} text-sm`}>{l}</a></li>)}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </Container>
    );
  }

  // ---------- Quiz / Excel ----------
  if (attempt?.submittedAt) {
    return (
      <Container className="py-10">
        {header}
        <Card>
          <div className="py-6 text-center">
            <div className="text-4xl">✓</div>
            <h2 className="mt-2 text-xl font-semibold text-ink">Submitted</h2>
            <p className="mt-1 text-sm text-muted">Your team submitted at {fmtDate(attempt.submittedAt)}. {round.resultsPublished ? `Score: ${attempt.autoScore ?? 0}${attempt.manualScore ? ` + ${attempt.manualScore}` : ""}.` : "Results appear on your dashboard once the organizers publish them."}</p>
          </div>
        </Card>
      </Container>
    );
  }

  if (blocker || st !== "LIVE") {
    return (
      <Container className="py-10">
        {header}
        {brief}
        <Alert tone="amber">{blocker ?? (st === "UPCOMING" ? `This round opens ${fmtDate(round.startsAt)}.` : "This round is closed.")}</Alert>
      </Container>
    );
  }

  if (!attempt) {
    return (
      <Container className="py-10">
        {header}
        {brief}
        <Card>
          <div className="space-y-3 text-sm text-ink/80">
            <p><strong>One attempt per team.</strong> Any member can start it; only one person should answer.</p>
            {round.durationMinutes && <p>You have <strong>{round.durationMinutes} minutes</strong> once you start. The timer keeps running if you close the page.</p>}
            {round.type === "QUIZ" && <p>{round.questions.length} questions. Switching tabs is logged for the organizers.</p>}
          </div>
          <form action={startAttempt} className="mt-6">
            <input type="hidden" name="roundId" value={round.id} />
            <SubmitButton pendingText="Starting…" confirm="Start now? The timer begins immediately.">Start {round.type === "QUIZ" ? "quiz" : "Excel round"}</SubmitButton>
          </form>
        </Card>
      </Container>
    );
  }

  const left = timeLeftMs(round, attempt.startedAt);
  const deadline = left === null ? null : Date.now() + left;

  if (round.type === "QUIZ") {
    const questions: ClientQuestion[] = seededShuffle(round.questions, team.id).map((q) => ({
      id: q.id,
      type: q.type,
      text: q.text,
      marks: q.marks,
      negativeMarks: q.negativeMarks,
      options: seededShuffle(parseJson<string[]>(q.options, []).map((label, index) => ({ index, label })), team.id + q.id),
    }));
    return (
      <Container className="py-10">
        {header}
        <QuizClient roundId={round.id} questions={questions} initial={parseJson(attempt.answers, {})} deadline={deadline} />
      </Container>
    );
  }

  const key = excelKey(round);
  return (
    <Container className="py-10">
      {header}
      {brief}
      <ExcelClient
        roundId={round.id}
        items={key.map((k) => ({ cell: k.cell, label: k.label, marks: k.marks }))}
        initial={parseJson(attempt.answers, {})}
        deadline={deadline}
        templateUrl={fileUrl(round.excelTemplate)}
        workbookName={attempt.fileUrl ? attempt.fileUrl.split("/").pop()!.replace(/^\d+-/, "") : null}
      />
    </Container>
  );
}
