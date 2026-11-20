"use client";

import { useEffect, useState } from "react";
import { Check, Lock } from "lucide-react";
import { fmtNumber, GUESS_TIERS, parseGuess, type PlayerState } from "@/lib/live-quiz-types";
import { postLive, useLivePoll } from "@/components/live-quiz-ui";
import { cls } from "@/components/ui";

function istTime(ms: number) {
  return new Date(ms).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", second: "2-digit" });
}

/** A team's screen for the guesstimate round: always shows the question the host is on, with a number box and Save. */
export function LivePlayer({ roundId, initial }: { roundId: string; initial: PlayerState }) {
  const { state: s, error, refetch } = useLivePoll<PlayerState>(`/api/live/${roundId}`, initial);
  const [value, setValue] = useState(s.mine ? String(s.mine.value) : "");
  const [dirty, setDirty] = useState(false);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const qid = s.question?.id ?? null;
  const savedValue = s.mine?.value ?? null;
  // New question: start from whatever the team saved for it (if the host came back to it).
  useEffect(() => {
    setValue(savedValue === null ? "" : String(savedValue));
    setDirty(false);
    setProblem(null);
    setJustSaved(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the question changes
  }, [qid]);
  // A teammate saved: show their answer unless this person is mid-edit.
  useEffect(() => {
    if (!dirty) setValue(savedValue === null ? "" : String(savedValue));
  }, [savedValue, dirty]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    if (parseGuess(value) === null) return setProblem("Enter a single number (digits only, commas allowed).");
    setSending(true);
    setProblem(null);
    try {
      const r = await postLive(roundId, { index: s.index, answer: value });
      if (r && !r.ok) setProblem(r.error);
      else if (r?.ok) { setDirty(false); setJustSaved(true); }
      await refetch();
    } finally {
      setSending(false);
    }
  }

  const parsed = parseGuess(value);
  const unsaved = dirty && parsed !== savedValue;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="font-semibold text-ink">{s.teamName}</span>
        {s.phase === "QUESTION" && <span className="text-muted">Question {s.index + 1} of {s.total} · {s.answeredCount} answered</span>}
      </div>
      {error && <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="status">Reconnecting… ({error})</p>}

      {s.phase === "NONE" && (
        <Panel>
          <h2 className="text-2xl font-bold text-ink">Waiting for the host</h2>
          <p className="mt-2 text-muted">This round is run live from the main screen. Keep this page open; it joins you automatically when the organisers open the lobby.</p>
          <div className="mx-auto mt-6 h-3 w-3 animate-ping rounded-full bg-sky-500" aria-hidden />
        </Panel>
      )}

      {s.phase === "LOBBY" && (
        <Panel>
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-8 w-8" /></div>
          <h2 className="text-3xl font-bold text-ink">You&apos;re in!</h2>
          <p className="mt-2 text-muted">{s.teamCount} {s.teamCount === 1 ? "team has" : "teams have"} joined. Questions appear here as the host shows them.</p>
          <ul className="mt-6 space-y-1 text-left text-sm text-ink/80">
            <li>• Answer each question with one number and press <strong>Save</strong>. Any teammate can save; the latest save counts.</li>
            <li>• You can change your answer while the host is on that question, including if the host goes back to it.</li>
            <li>• Scoring: within 5% of the answer = {GUESS_TIERS[0].points} points, within 10% = {GUESS_TIERS[1].points}, within 20% = {GUESS_TIERS[2].points}, further = 0.</li>
          </ul>
        </Panel>
      )}

      {s.phase === "QUESTION" && s.question && (
        <div className="glass rounded-3xl p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Question {s.index + 1} of {s.total}</p>
          <h2 className="mt-2 text-xl font-semibold leading-snug text-ink sm:text-2xl">{s.question.text}</h2>
          <form onSubmit={save} className="mt-6 space-y-3">
            <label htmlFor="guess" className={cls.label}>Your team&apos;s answer (one number)</label>
            <input
              id="guess"
              inputMode="decimal"
              autoComplete="off"
              value={value}
              onChange={(e) => { setValue(e.target.value); setDirty(true); setJustSaved(false); }}
              placeholder="e.g. 125000"
              className={`${cls.input} py-4 text-2xl font-semibold tabular-nums`}
              aria-describedby="guess-status"
            />
            {parsed !== null && value.trim() && <p className="text-sm text-muted">Reads as <strong className="text-ink">{fmtNumber(parsed)}</strong></p>}
            <button type="submit" disabled={sending || !value.trim()} className={`${cls.btn} ${cls.primary} w-full py-4 text-lg`}>{sending ? "Saving…" : s.mine ? "Update answer" : "Save answer"}</button>
            <p id="guess-status" className="text-sm" role="status">
              {problem ? <span className="font-medium text-red-700">{problem}</span>
                : unsaved ? <span className="font-medium text-amber-700">Not saved yet. Press Save to keep this answer.</span>
                : s.mine ? <span className="text-emerald-700">{justSaved ? "Saved. " : ""}Saved answer: <strong>{fmtNumber(s.mine.value)}</strong> by {s.mine.savedBy} at {istTime(s.mine.savedAt)}</span>
                : <span className="text-muted">No answer saved for this question yet.</span>}
            </p>
          </form>
        </div>
      )}

      {s.phase === "FINISHED" && (
        <div className="glass rounded-3xl p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <Lock className="h-6 w-6 text-sky-700" />
            <div>
              <h2 className="text-2xl font-bold text-ink">Your answer sheet</h2>
              <p className="text-sm text-muted">The round has ended and answers are locked. {s.resultsPublished ? "Results are published." : "Correct answers and points appear once results are published."}</p>
            </div>
          </div>
          <div className="mt-6 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3">#</th><th className="py-2 pr-3">Question</th><th className="py-2 pr-3 text-right">Your answer</th>
                  {s.resultsPublished && <><th className="py-2 pr-3 text-right">Correct</th><th className="py-2 text-right">Points</th></>}
                </tr>
              </thead>
              <tbody>
                {s.review.map((r) => (
                  <tr key={r.index} className="border-t border-line align-top">
                    <td className="py-2 pr-3 text-muted">{r.index + 1}</td>
                    <td className="py-2 pr-3 text-ink">{r.text}</td>
                    <td className="py-2 pr-3 text-right font-semibold tabular-nums text-ink">{r.value === null ? <span className="font-normal text-muted">No answer</span> : fmtNumber(r.value)}</td>
                    {s.resultsPublished && <><td className="py-2 pr-3 text-right tabular-nums">{fmtNumber(r.correct)}</td><td className="py-2 text-right font-semibold tabular-nums">{r.points}</td></>}
                  </tr>
                ))}
              </tbody>
              {s.resultsPublished && (
                <tfoot><tr className="border-t border-line font-semibold"><td colSpan={4} className="py-2 text-right">Total</td><td className="py-2 text-right tabular-nums">{s.review.reduce((a, r) => a + (r.points ?? 0), 0)}</td></tr></tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="glass rounded-3xl p-8 text-center">{children}</div>;
}
