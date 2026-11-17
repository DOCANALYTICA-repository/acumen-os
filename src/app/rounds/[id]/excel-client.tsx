"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveAnswer, submitAttempt, uploadWorkbook } from "@/app/actions/rounds";
import type { FormState } from "@/app/actions/auth";
import { Alert, cls } from "@/components/ui";
import { SubmitButton } from "@/components/submit-button";

type Item = { cell: string; label: string; marks: number };

export function ExcelClient({ roundId, items, initial, deadline, templateUrl, workbookName }: {
  roundId: string; items: Item[]; initial: Record<string, string>; deadline: number | null; templateUrl: string; workbookName: string | null;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [status, setStatus] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const done = useRef(false);
  const [uploadState, uploadAction] = useActionState<FormState, FormData>(uploadWorkbook, undefined);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (deadline && now >= deadline && !done.current) {
      done.current = true;
      void submitAttempt(roundId).then(() => router.refresh());
    }
  }, [now, deadline, roundId, router]);

  async function save(cell: string, v: string) {
    if ((initial[cell] ?? "") === v && !status) return;
    setStatus("Saving…");
    const r = await saveAnswer(roundId, cell, v);
    setStatus(r.ok ? "All answers saved" : r.error);
    if (!r.ok) router.refresh();
  }

  const left = deadline ? Math.max(0, deadline - now) : null;
  const mm = left !== null ? `${String(Math.floor(left / 60000)).padStart(2, "0")}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}` : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div className="space-y-6">
        <div className="rounded-xl border border-line bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-ink">Answer sheet</h2>
            <span className="text-xs text-muted">{status}</span>
          </div>
          <div className="space-y-4">
            {items.map((it) => (
              <label key={it.cell} className="block">
                <span className="mb-1 flex justify-between text-sm font-medium text-ink">
                  <span>{it.label}</span>
                  <span className="text-xs text-muted">{it.cell} · {it.marks} marks</span>
                </span>
                <input
                  className={cls.input}
                  value={values[it.cell] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [it.cell]: e.target.value }))}
                  onBlur={(e) => save(it.cell, e.target.value.trim())}
                  placeholder="Your answer"
                />
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-line bg-white p-6 shadow-sm">
          <h2 className="font-semibold text-ink">Upload your workbook (optional)</h2>
          <p className="mt-1 text-sm text-muted">Organizers can review your formulas. Answers left empty above are read from the file&apos;s Answers sheet.</p>
          <form action={uploadAction} className="mt-4 space-y-3">
            <input type="hidden" name="roundId" value={roundId} />
            {uploadState?.error && <Alert tone="red">{uploadState.error}</Alert>}
            {uploadState?.ok && <Alert tone="green">{uploadState.ok}</Alert>}
            {workbookName && <p className="text-sm text-ink">Current file: <strong>{workbookName}</strong></p>}
            <input type="file" name="workbook" accept=".xlsx" className={cls.input} />
            <SubmitButton variant="secondary" pendingText="Uploading…">Upload .xlsx</SubmitButton>
          </form>
        </div>
      </div>

      <aside className="space-y-4">
        {mm && (
          <div className={`rounded-xl p-4 text-center ${left! < 120_000 ? "bg-red-600 text-white" : "bg-ink text-white"}`}>
            <div className="text-xs uppercase tracking-wider opacity-70">Time left</div>
            <div className="font-mono text-3xl font-bold tabular-nums">{mm}</div>
          </div>
        )}
        <a href={templateUrl} className={`${cls.btn} ${cls.secondary} w-full`}>Download case workbook</a>
        <button
          className={`${cls.btn} ${cls.primary} w-full`}
          onClick={async () => {
            if (!window.confirm("Submit your Excel answers? You cannot change them after this.")) return;
            done.current = true;
            await submitAttempt(roundId);
            router.refresh();
          }}
        >
          Submit answers
        </button>
        <p className="text-xs text-muted">Answers save when you leave each box. Numeric answers are checked with a small tolerance.</p>
      </aside>
    </div>
  );
}
