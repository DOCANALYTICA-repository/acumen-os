import Link from "next/link";
import { notFound } from "next/navigation";
import { parseConfig } from "@/lib/sim/model";
import { db, parseJson } from "@/lib/db";
import { manualSettings, submissionSettings, TYPE_LABEL } from "@/lib/rounds";
import { quizMax } from "@/lib/scoring";
import { fmtNumber } from "@/lib/live-quiz-types";
import { addQuestion, deleteQuestion, importQuestions, moveQuestion, saveRubric, setManualScore, setOffPlatformScore, updateRound } from "@/app/actions/admin";
import { Badge, Card, Field, PageHeader, cls, fmtDate } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

/** Date → value for <input type="datetime-local"> in IST. */
function toIstInput(d: Date | null) {
  return d ? new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16) : "";
}

export default async function AdminRound({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const round = await db.round.findUnique({
    where: { id },
    include: {
      questions: { orderBy: { order: "asc" } },
      criteria: true,
      attempts: { include: { team: true }, orderBy: { autoScore: "desc" } },
      economy: { select: { config: true, status: true } },
      liveQuiz: { select: { status: true, currentIndex: true } },
    },
  });
  if (!round) notFound();
  const rules = submissionSettings(round);
  const manual = manualSettings(round);
  const max =
    round.type === "QUIZ" ? quizMax(round.questions)
    : round.type === "SIMULATION" ? parseConfig(round.economy?.config).scoring.maxMarks
    : round.type === "MANUAL" ? manual.maxMarks
    : round.criteria.reduce((s, c) => s + c.maxMarks, 0);
  // Off-platform rounds list every team that may enter, so marks can be entered even if a team forgot to click "done".
  const manualTeams = round.type === "MANUAL"
    ? await db.team.findMany({
        where: { paymentStatus: "PAID", disqualified: false, ...(round.restrictToQualified ? { qualifications: { some: { roundId: round.id } } } : {}) },
        orderBy: { name: "asc" },
      })
    : [];

  return (
    <>
      <PageHeader title={round.name} subtitle={<>{TYPE_LABEL[round.type]} round · max {max} marks</>} />

      <Card title="Settings" className="mb-6">
        <form action={updateRound} className="space-y-4">
          <input type="hidden" name="id" value={round.id} />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Name"><input name="name" defaultValue={round.name} className={cls.input} /></Field>
            <Field label="Status" hint="Scheduled rounds open and close on their dates">
              <select name="status" defaultValue={round.status} className={cls.input}>
                <option value="DRAFT">Draft (hidden)</option>
                <option value="SCHEDULED">Scheduled</option>
                <option value="LIVE">Live now (until end time)</option>
                <option value="CLOSED">Closed</option>
              </select>
            </Field>
            <Field label="Starts (IST)"><input type="datetime-local" name="startsAt" defaultValue={toIstInput(round.startsAt)} className={cls.input} /></Field>
            <Field label="Ends (IST)"><input type="datetime-local" name="endsAt" defaultValue={toIstInput(round.endsAt)} className={cls.input} /></Field>
            <Field label="Leaderboard weight" hint="Relative weight in the overall score"><input type="number" step="0.5" min={0} name="weight" defaultValue={round.weight} className={cls.input} /></Field>
          </div>
          <Field label="Description"><textarea name="description" rows={2} defaultValue={round.description} className={cls.input} /></Field>
          <Field label="Instructions"><textarea name="instructions" rows={3} defaultValue={round.instructions} className={cls.input} /></Field>
          <Field label="Brief link" hint="Optional: a Google Drive / Classroom link to the round brief, shown to teams as “Open brief”"><input name="briefUrl" type="url" placeholder="https://drive.google.com/…" defaultValue={round.briefUrl ?? ""} className={cls.input} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="restrictToQualified" defaultChecked={round.restrictToQualified} /> Only qualified teams can enter (set the cut-off on Results)</label>

          {round.type === "MANUAL" && (
            <div className="rounded-lg border border-line p-4">
              <div className="mb-3 text-sm font-semibold text-ink">Off-platform round</div>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Maximum marks"><input type="number" name="maxMarks" min={1} step="0.5" defaultValue={manual.maxMarks} className={cls.input} /></Field>
                <Field label="Link for teams" hint="Optional, e.g. the Google Classroom assignment"><input name="link" type="url" placeholder="https://classroom.google.com/…" defaultValue={manual.link} className={cls.input} /></Field>
                <Field label="Link button text"><input name="linkLabel" defaultValue={manual.linkLabel} className={cls.input} /></Field>
              </div>
            </div>
          )}

          {round.type === "SUBMISSION" && (
            <div className="rounded-lg border border-line p-4">
              <div className="mb-3 text-sm font-semibold text-ink">Submission rules</div>
              <p className="mb-3 text-xs text-muted">Teams submit links (Drive, Classroom, YouTube…), up to 5 per submission. Nothing is uploaded to the site.</p>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Late penalty (%)"><input type="number" name="latePenaltyPct" min={0} max={100} defaultValue={rules.latePenaltyPct} className={cls.input} /></Field>
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" name="allowResubmit" defaultChecked={rules.allowResubmit} /> Allow resubmission until deadline</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="allowLate" defaultChecked={rules.allowLate} /> Accept late submissions</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="anonymousJudging" defaultChecked={rules.anonymousJudging} /> Hide team names from judges</label>
              </div>
            </div>
          )}
          <SubmitButton>Save settings</SubmitButton>
        </form>
      </Card>


      {round.type === "SIMULATION" && (
        <Card title="Startup Ecosystem simulation" className="mb-6">
          <p className="text-sm text-ink/80">
            Economy, startup assignments, cycles, market events and monitoring live in the simulation control room.
            {round.economy ? ` Current state: ${round.economy.status.toLowerCase()}.` : " No economy has been created yet."}
          </p>
          <Link href={`/admin/simulation/${round.id}`} className={`${cls.btn} ${cls.primary} mt-4`}>Open control room</Link>
        </Card>
      )}

      {round.type === "QUIZ" && (
        <>
          <Card title="Guesstimate (host-led)" className="mb-6">
            <p className="text-sm text-ink/80">
              Put the host screen on the projector and open the lobby; teams join from their own devices. Whichever question you show, every team sees that
              question with a box for one number and a Save button. You can go back to any question and teams can change their saved answer while it is shown.
              End the round to lock answers: teams then see a read-only answer sheet, and marks are saved here.
            </p>
            <p className="mt-2 text-sm text-ink/80">Scoring per question: within 5% of the correct answer = 3, within 10% = 2, within 20% = 1, otherwise 0 (max {max} for {round.questions.length} questions).</p>
            <p className="mt-2 text-sm text-muted">
              {round.liveQuiz
                ? round.liveQuiz.status === "FINISHED" ? "Round ended. Answers are locked."
                  : round.liveQuiz.status === "LOBBY" ? "Lobby is open: teams are joining."
                  : `In progress: showing question ${round.liveQuiz.currentIndex + 1} of ${round.questions.length}.`
                : "No game open yet."}
            </p>
            <Link href={`/host/${round.id}`} className={`${cls.btn} ${cls.primary} mt-4`}>Open host screen</Link>
          </Card>
          <Card title={`Questions (${round.questions.length})`} className="mb-6">
            {round.liveQuiz && <p className="mb-3 text-xs text-amber-800">A game is open: question order was fixed when the lobby opened. Changes here apply after a reset.</p>}
            <ol className="space-y-3">
              {round.questions.map((q, i) => (
                <li key={q.id} className="flex items-start justify-between gap-4 rounded-lg border border-line p-3">
                  <div className="text-sm">
                    <div className="font-medium text-ink">{i + 1}. {q.text}</div>
                    <div className="mt-1 text-xs"><Badge tone="green">Answer: {fmtNumber(parseJson<number | null>(q.answer, null))}</Badge>{q.explanation && <span className="ml-2 text-muted">{q.explanation}</span>}</div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <form action={moveQuestion}><input type="hidden" name="id" value={q.id} /><input type="hidden" name="dir" value="up" /><SubmitButton variant="secondary" className="px-2 py-1 text-xs" disabled={i === 0}>↑</SubmitButton></form>
                    <form action={moveQuestion}><input type="hidden" name="id" value={q.id} /><input type="hidden" name="dir" value="down" /><SubmitButton variant="secondary" className="px-2 py-1 text-xs" disabled={i === round.questions.length - 1}>↓</SubmitButton></form>
                    <form action={deleteQuestion}><input type="hidden" name="id" value={q.id} /><SubmitButton variant="secondary" className="px-2 py-1 text-xs" confirm="Delete this question?">Delete</SubmitButton></form>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
          <div className="mb-6 grid gap-6 xl:grid-cols-2">
            <Card title="Add question">
              <form action={addQuestion} className="space-y-3">
                <input type="hidden" name="roundId" value={round.id} />
                <Field label="Question"><textarea name="text" rows={2} required className={cls.input} placeholder="How many cups of tea are sold in India each day?" /></Field>
                <Field label="Correct answer" hint="One number. Commas are fine (e.g. 1,200,000)."><input name="answer" required inputMode="decimal" className={cls.input} /></Field>
                <Field label="Note (optional)" hint="Shown with the answer, e.g. the source or unit"><input name="explanation" className={cls.input} /></Field>
                <SubmitButton>Add question</SubmitButton>
              </form>
            </Card>
            <Card title="Import from CSV">
              <p className="mb-3 text-sm text-muted">Columns: <code>question,answer,note</code> (note optional). Put quotes around any cell that contains a comma.</p>
              <pre className="mb-3 overflow-x-auto rounded bg-surface p-2 text-xs">&quot;How many petrol pumps are there in India?&quot;,90000,PPAC 2024</pre>
              <form action={importQuestions} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="roundId" value={round.id} />
                <input type="file" name="file" accept=".csv" className={`${cls.input} max-w-xs`} />
                <SubmitButton variant="secondary">Import</SubmitButton>
              </form>
            </Card>
          </div>
        </>
      )}

      {round.type === "SUBMISSION" && (
        <Card title="Judging rubric" className="mb-6">
          <form action={saveRubric} className="space-y-2">
            <input type="hidden" name="roundId" value={round.id} />
            {[...round.criteria, { id: "", name: "", maxMarks: 0 }, { id: "", name: "", maxMarks: 0 }].map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_120px] gap-2">
                <input type="hidden" name="criterionId" value={c.id} />
                <input name="criterionName" defaultValue={c.name} placeholder="Criterion" className={cls.input} />
                <input name="criterionMax" type="number" step="0.5" defaultValue={c.maxMarks || ""} placeholder="Max marks" className={cls.input} />
              </div>
            ))}
            <p className="text-xs text-muted">Total: {round.criteria.reduce((s, c) => s + c.maxMarks, 0)} marks. Clear a name to remove that criterion (its scores are deleted).</p>
            <SubmitButton>Save rubric</SubmitButton>
          </form>
        </Card>
      )}

      {round.type === "MANUAL" && (
        <Card title={`Teams (${manualTeams.length}) · ${round.attempts.filter((a) => a.submittedAt).length} marked done · ${round.attempts.filter((a) => a.manualScore != null).length} scored`}>
          {manualTeams.length === 0 ? <p className="text-sm text-muted">No eligible teams yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr><th className={cls.th}>Team</th><th className={cls.th}>Marked done</th><th className={cls.th}>Marks (out of {manual.maxMarks})</th></tr></thead>
                <tbody>
                  {manualTeams.map((t) => {
                    const a = round.attempts.find((x) => x.teamId === t.id);
                    const { markedBy: by, link } = parseJson<{ markedBy?: string; link?: string }>(a?.answers, {});
                    return (
                      <tr key={t.id} className="border-t border-line">
                        <td className={cls.td}>{t.name}</td>
                        <td className={`${cls.td} text-xs`}>{a?.submittedAt ? <>{fmtDate(a.submittedAt)}{by ? ` · ${by}` : ""}{link && <><br /><a href={link} target="_blank" rel="noreferrer" className={`${cls.ghost} break-all`}>Open link</a></>}</> : <Badge tone="amber">not yet</Badge>}</td>
                        <td className={cls.td}>
                          <form action={setOffPlatformScore} className="flex gap-1">
                            <input type="hidden" name="roundId" value={round.id} />
                            <input type="hidden" name="teamId" value={t.id} />
                            <input name="score" type="number" step="0.5" min={0} max={manual.maxMarks} defaultValue={a?.manualScore ?? ""} className={`${cls.input} w-24 py-1`} aria-label={`Marks for ${t.name}`} />
                            <SubmitButton variant="secondary" className="px-2 py-1 text-xs">Save</SubmitButton>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-muted">Clear a mark and save to remove it. Marks appear to teams once results are published.</p>
        </Card>
      )}

      {round.type !== "SUBMISSION" && round.type !== "MANUAL" && (
        <Card title={round.type === "SIMULATION" ? `Final simulation marks (${round.attempts.length})` : `Attempts (${round.attempts.length})`}>
          {round.attempts.length === 0 ? <p className="text-sm text-muted">No attempts yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr><th className={cls.th}>Team</th><th className={cls.th}>Started</th><th className={cls.th}>Submitted</th><th className={cls.th}>Auto score</th><th className={cls.th}>Manual marks</th></tr></thead>
                <tbody>
                  {round.attempts.map((a) => (
                    <tr key={a.id} className="border-t border-line">
                      <td className={cls.td}>{a.team.name}</td>
                      <td className={`${cls.td} text-xs`}>{fmtDate(a.startedAt)}</td>
                      <td className={`${cls.td} text-xs`}>{a.submittedAt ? fmtDate(a.submittedAt) : <Badge tone="amber">in progress</Badge>}</td>
                      <td className={cls.td}>{a.autoScore ?? "—"} / {max}</td>
                      <td className={cls.td}>
                        <form action={setManualScore} className="flex gap-1">
                          <input type="hidden" name="attemptId" value={a.id} />
                          <input name="manualScore" type="number" step="0.5" defaultValue={a.manualScore ?? ""} className={`${cls.input} w-20 py-1`} />
                          <SubmitButton variant="secondary" className="px-2 py-1 text-xs">Save</SubmitButton>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
