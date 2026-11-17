import { notFound } from "next/navigation";
import { db, parseJson } from "@/lib/db";
import { ALL_FILE_TYPES, excelKey, submissionSettings, TYPE_LABEL } from "@/lib/rounds";
import { excelMax, quizMax } from "@/lib/scoring";
import { fileUrl } from "@/lib/files";
import { addQuestion, deleteQuestion, importQuestions, saveExcelKey, saveRubric, setManualScore, updateRound, uploadRoundFile } from "@/app/actions/admin";
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
    },
  });
  if (!round) notFound();
  const rules = submissionSettings(round);
  const key = excelKey(round);
  const max = round.type === "QUIZ" ? quizMax(round.questions) : round.type === "EXCEL" ? excelMax(key) : round.criteria.reduce((s, c) => s + c.maxMarks, 0);

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
            {round.type !== "SUBMISSION" && (
              <Field label="Timer (minutes)" hint="Per team, from when they press Start"><input type="number" min={1} name="durationMinutes" defaultValue={round.durationMinutes ?? ""} className={cls.input} /></Field>
            )}
            <Field label="Leaderboard weight" hint="Relative weight in the overall score"><input type="number" step="0.5" min={0} name="weight" defaultValue={round.weight} className={cls.input} /></Field>
          </div>
          <Field label="Description"><textarea name="description" rows={2} defaultValue={round.description} className={cls.input} /></Field>
          <Field label="Instructions"><textarea name="instructions" rows={3} defaultValue={round.instructions} className={cls.input} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="restrictToQualified" defaultChecked={round.restrictToQualified} /> Only qualified teams can enter (set the cut-off on Results)</label>

          {round.type === "SUBMISSION" && (
            <div className="rounded-lg border border-line p-4">
              <div className="mb-3 text-sm font-semibold text-ink">Submission rules</div>
              <div className="mb-3 flex flex-wrap gap-3">
                {ALL_FILE_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-1 text-sm"><input type="checkbox" name="allowedTypes" value={t} defaultChecked={rules.allowedTypes.includes(t)} /> {t}</label>
                ))}
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Max file size (MB)"><input type="number" name="maxSizeMB" min={1} max={500} defaultValue={rules.maxSizeMB} className={cls.input} /></Field>
                <Field label="Files per submission"><input type="number" name="maxFiles" min={1} max={10} defaultValue={rules.maxFiles} className={cls.input} /></Field>
                <Field label="Late penalty (%)"><input type="number" name="latePenaltyPct" min={0} max={100} defaultValue={rules.latePenaltyPct} className={cls.input} /></Field>
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" name="allowResubmit" defaultChecked={rules.allowResubmit} /> Allow resubmission until deadline</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="allowLate" defaultChecked={rules.allowLate} /> Accept late submissions</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="allowLinks" defaultChecked={rules.allowLinks} /> Allow links</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="anonymousJudging" defaultChecked={rules.anonymousJudging} /> Hide team names from judges</label>
              </div>
            </div>
          )}
          <SubmitButton>Save settings</SubmitButton>
        </form>
      </Card>

      <Card title="Brief file" className="mb-6">
        {round.briefFile && <p className="mb-3 text-sm"><a href={fileUrl(round.briefFile)} className={cls.ghost}>Current brief</a></p>}
        <form action={uploadRoundFile} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={round.id} />
          <input type="hidden" name="kind" value="brief" />
          <input type="file" name="file" className={`${cls.input} max-w-sm`} />
          <SubmitButton variant="secondary">Upload brief</SubmitButton>
        </form>
      </Card>

      {round.type === "QUIZ" && (
        <>
          <Card title={`Questions (${round.questions.length})`} className="mb-6">
            <ol className="space-y-3">
              {round.questions.map((q, i) => {
                const opts = parseJson<string[]>(q.options, []);
                const ans = parseJson<unknown>(q.answer, null);
                const shown = q.type === "SINGLE" ? opts[ans as number] : q.type === "MULTI" ? (ans as number[]).map((x) => opts[x]).join(", ") : String(ans);
                return (
                  <li key={q.id} className="flex items-start justify-between gap-4 rounded-lg border border-line p-3">
                    <div className="text-sm">
                      <div className="font-medium text-ink">{i + 1}. {q.text}</div>
                      {opts.length > 0 && <div className="mt-1 text-xs text-muted">{opts.join(" · ")}</div>}
                      <div className="mt-1 text-xs"><Badge tone="green">Answer: {shown}</Badge> <Badge>{q.type}</Badge> <Badge>{q.marks} marks{q.negativeMarks ? `, −${q.negativeMarks}` : ""}</Badge></div>
                    </div>
                    <form action={deleteQuestion}><input type="hidden" name="id" value={q.id} /><SubmitButton variant="secondary" className="px-2 py-1 text-xs" confirm="Delete this question?">Delete</SubmitButton></form>
                  </li>
                );
              })}
            </ol>
          </Card>
          <div className="mb-6 grid gap-6 xl:grid-cols-2">
            <Card title="Add question">
              <form action={addQuestion} className="space-y-3">
                <input type="hidden" name="roundId" value={round.id} />
                <Field label="Type">
                  <select name="type" className={cls.input}>
                    <option value="SINGLE">Single choice</option>
                    <option value="MULTI">Multiple select</option>
                    <option value="TRUEFALSE">True / false</option>
                    <option value="SHORT">Short answer</option>
                  </select>
                </Field>
                <Field label="Question"><textarea name="text" rows={2} required className={cls.input} /></Field>
                <Field label="Options" hint="One per line (choice questions only)"><textarea name="options" rows={4} className={cls.input} /></Field>
                <Field label="Correct answer" hint="Option number (e.g. 2), several for multiple select (1,3), true/false, or the exact text/number"><input name="answer" required className={cls.input} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Marks"><input type="number" step="0.5" name="marks" defaultValue={1} className={cls.input} /></Field>
                  <Field label="Negative marks"><input type="number" step="0.25" name="negativeMarks" defaultValue={0} className={cls.input} /></Field>
                </div>
                <SubmitButton>Add question</SubmitButton>
              </form>
            </Card>
            <Card title="Import from CSV">
              <p className="mb-3 text-sm text-muted">Columns: <code>type,text,options,answer,marks,negative</code>. Options separated by <code>|</code>; answers are option numbers (multi: <code>1;3</code>).</p>
              <pre className="mb-3 overflow-x-auto rounded bg-surface p-2 text-xs">SINGLE,&quot;What is 2+2?&quot;,3|4|5,2,1,0.25</pre>
              <form action={importQuestions} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="roundId" value={round.id} />
                <input type="file" name="file" accept=".csv" className={`${cls.input} max-w-xs`} />
                <SubmitButton variant="secondary">Import</SubmitButton>
              </form>
            </Card>
          </div>
        </>
      )}

      {round.type === "EXCEL" && (
        <div className="mb-6 grid gap-6">
          <Card title="Case workbook">
            {round.excelTemplate ? <p className="mb-3 text-sm"><a href={fileUrl(round.excelTemplate)} className={cls.ghost}>Download current workbook</a></p> : <p className="mb-3 text-sm text-muted">No workbook uploaded.</p>}
            <form action={uploadRoundFile} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={round.id} />
              <input type="hidden" name="kind" value="template" />
              <input type="file" name="file" accept=".xlsx" className={`${cls.input} max-w-sm`} />
              <SubmitButton variant="secondary">Upload .xlsx</SubmitButton>
            </form>
          </Card>
          <Card title="Answer key">
            <p className="mb-3 text-sm text-muted">Cells are read from uploaded workbooks (<code>Sheet!B2</code>); typed answers use the same keys. Tolerance applies to numbers.</p>
            <form action={saveExcelKey} className="space-y-2">
              <input type="hidden" name="roundId" value={round.id} />
              <div className="grid grid-cols-[110px_1fr_140px_90px_70px] gap-2 text-xs font-semibold text-muted"><span>Cell</span><span>Question label</span><span>Correct value</span><span>Tolerance</span><span>Marks</span></div>
              {[...key, ...Array.from({ length: 2 }, () => ({ cell: "", label: "", value: "", tolerance: 0, marks: 0 }))].map((k, i) => (
                <div key={i} className="grid grid-cols-[110px_1fr_140px_90px_70px] gap-2">
                  <input name="cell" defaultValue={k.cell} className={cls.input} placeholder="Answers!B7" />
                  <input name="label" defaultValue={k.label} className={cls.input} />
                  <input name="value" defaultValue={k.value} className={cls.input} />
                  <input name="tolerance" type="number" step="any" defaultValue={k.tolerance} className={cls.input} />
                  <input name="marks" type="number" step="0.5" defaultValue={k.marks} className={cls.input} />
                </div>
              ))}
              <p className="text-xs text-muted">Clear a row&apos;s cell to remove it. Save to add more blank rows.</p>
              <SubmitButton>Save answer key</SubmitButton>
            </form>
          </Card>
        </div>
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

      {round.type !== "SUBMISSION" && (
        <Card title={`Attempts (${round.attempts.length})`}>
          {round.attempts.length === 0 ? <p className="text-sm text-muted">No attempts yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr><th className={cls.th}>Team</th><th className={cls.th}>Started</th><th className={cls.th}>Submitted</th><th className={cls.th}>Auto score</th><th className={cls.th}>Tab switches</th><th className={cls.th}>Manual marks</th><th className={cls.th}>File</th></tr></thead>
                <tbody>
                  {round.attempts.map((a) => (
                    <tr key={a.id} className="border-t border-line">
                      <td className={cls.td}>{a.team.name}</td>
                      <td className={`${cls.td} text-xs`}>{fmtDate(a.startedAt)}</td>
                      <td className={`${cls.td} text-xs`}>{a.submittedAt ? fmtDate(a.submittedAt) : <Badge tone="amber">in progress</Badge>}</td>
                      <td className={cls.td}>{a.autoScore ?? "—"} / {max}</td>
                      <td className={cls.td}>{a.tabSwitches >= 3 ? <Badge tone="red">{a.tabSwitches}</Badge> : a.tabSwitches}</td>
                      <td className={cls.td}>
                        <form action={setManualScore} className="flex gap-1">
                          <input type="hidden" name="attemptId" value={a.id} />
                          <input name="manualScore" type="number" step="0.5" defaultValue={a.manualScore ?? ""} className={`${cls.input} w-20 py-1`} />
                          <SubmitButton variant="secondary" className="px-2 py-1 text-xs">Save</SubmitButton>
                        </form>
                      </td>
                      <td className={cls.td}>{a.fileUrl ? <a href={fileUrl(a.fileUrl)} className={cls.ghost}>xlsx</a> : "—"}</td>
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
