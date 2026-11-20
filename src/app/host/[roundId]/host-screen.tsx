"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Lock, Maximize2, Users } from "lucide-react";
import { fmtNumber, GUESS_TIERS, type HostState, type LiveResult } from "@/lib/live-quiz-types";
import { postLive, useLivePoll } from "@/components/live-quiz-ui";
import { cls } from "@/components/ui";

/** Projector view for the guesstimate round. The host moves everyone between questions, forwards or back. */
export function HostScreen({ roundId, roundName, roundOrder, initial }: { roundId: string; roundName: string; roundOrder: number; initial: HostState }) {
  const { state: s, error, refetch } = useLivePoll<HostState>(`/api/live/${roundId}?view=host`, initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [showSheet, setShowSheet] = useState(false);
  useEffect(() => setOrigin(window.location.origin), []);

  const run = useCallback(
    async (command: string, index: number, confirmText?: string) => {
      if (busy || (confirmText && !window.confirm(confirmText))) return;
      setBusy(true);
      setMsg(null);
      try {
        const r: LiveResult | null = await postLive(roundId, { command, index });
        if (r && !r.ok) setMsg(r.error);
        await refetch();
      } finally {
        setBusy(false);
      }
    },
    [busy, refetch, roundId],
  );

  const canPrev = s.phase === "QUESTION" && s.index > 0;
  const canNext = (s.phase === "QUESTION" && s.index + 1 < s.total) || s.phase === "LOBBY";
  const go = useCallback((delta: number) => run("goto", s.phase === "LOBBY" ? 0 : s.index + delta), [run, s.phase, s.index]);

  // ← / → (or a presentation clicker) move between questions.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input,textarea,select,button")) return;
      if ((e.key === "ArrowRight" || e.key === "PageDown") && canNext) { e.preventDefault(); void go(1); }
      if ((e.key === "ArrowLeft" || e.key === "PageUp") && canPrev) { e.preventDefault(); void go(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canNext, canPrev, go]);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-10rem)] max-w-7xl flex-col px-4 pb-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Guesstimate host</div>
          <h1 className="truncate text-xl font-bold text-ink">{roundName}</h1>
        </div>
        {s.phase === "QUESTION" && <span className="rounded-full bg-white/80 px-3 py-1 text-sm font-semibold text-ink shadow-soft">Question {s.index + 1} / {s.total}</span>}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-sm font-semibold text-ink shadow-soft"><Users className="h-4 w-4" /> {s.teams.length} teams</span>
        <button type="button" onClick={() => document.documentElement.requestFullscreen?.()} className={`${cls.btn} ${cls.secondary}`} title="Full screen" aria-label="Full screen"><Maximize2 className="h-4 w-4" /></button>
        <Link href={`/admin/rounds/${roundId}`} className={`${cls.btn} ${cls.secondary}`}>Round settings</Link>
      </header>

      {(error || msg) && <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800" role="alert">{msg ?? `Connection problem: ${error}. Retrying…`}</p>}

      <section className="glass flex flex-1 flex-col rounded-3xl p-6 sm:p-10">
        {s.phase === "NONE" && (
          <Center>
            <h2 className="text-4xl font-bold text-ink sm:text-5xl">Guesstimate</h2>
            <p className="mt-3 text-lg text-muted">{s.total} questions. Opening the lobby lets teams join from their phones or laptops.</p>
            {s.total === 0 && <p className="mt-4 text-red-700">Add questions on the round settings page first.</p>}
            {s.hasResults && <p className="mt-4 max-w-xl text-amber-800">This round already has marks from an earlier game. Reset the game to clear them before opening a new lobby.</p>}
          </Center>
        )}

        {s.phase === "LOBBY" && (
          <div className="flex flex-1 flex-col">
            <div className="text-center">
              <p className="text-lg text-muted">Join now</p>
              <h2 className="mt-1 text-3xl font-bold text-ink sm:text-5xl">Sign in at <span className="text-sky-700">{origin.replace(/^https?:\/\//, "") || "the Acumen site"}</span></h2>
              <p className="mt-3 text-lg text-muted sm:text-xl">Then open <strong className="text-ink">Dashboard → Round {roundOrder}</strong>. Answer each question with one number and press Save.</p>
              <p className="mt-2 text-muted">Within 5% of the answer = {GUESS_TIERS[0].points} points · within 10% = {GUESS_TIERS[1].points} · within 20% = {GUESS_TIERS[2].points} · further = 0</p>
            </div>
            <div className="mt-10 flex items-center justify-center gap-3 text-2xl font-bold text-ink"><Users className="h-7 w-7" /> {s.teams.length} {s.teams.length === 1 ? "team" : "teams"} joined</div>
            <ul className="mt-6 flex flex-wrap justify-center gap-3">
              {s.teams.map((t) => <li key={t.id} className="rounded-full bg-white/90 px-5 py-2 text-lg font-semibold text-ink shadow-soft">{t.name}</li>)}
            </ul>
            {s.teams.length === 0 && <p className="mt-6 text-center text-muted">Waiting for the first team…</p>}
          </div>
        )}

        {s.phase === "QUESTION" && s.question && (
          <div className="flex flex-1 flex-col">
            <p className="text-center text-lg font-semibold uppercase tracking-wide text-muted">Question {s.index + 1} of {s.total}</p>
            <div className="flex flex-1 items-center justify-center">
              <h2 className="max-w-5xl text-center text-3xl font-bold leading-tight text-ink sm:text-5xl">{s.question.text}</h2>
            </div>
            <p className="text-center text-xl text-muted">
              <span className="text-4xl font-bold tabular-nums text-ink">{s.saved}</span> / {s.teams.length} teams have saved an answer
            </p>
            <nav className="mt-6 flex flex-wrap justify-center gap-2" aria-label="Jump to question">
              {s.questions.map((q, i) => (
                <button key={q.id} type="button" disabled={busy} onClick={() => run("goto", i)}
                  className={`h-9 w-9 rounded-full text-sm font-semibold transition ${i === s.index ? "bg-sky-600 text-white" : "bg-white/80 text-ink hover:bg-white"}`}
                  aria-current={i === s.index ? "step" : undefined} aria-label={`Question ${i + 1}`}>{i + 1}</button>
              ))}
            </nav>
          </div>
        )}

        {s.phase === "FINISHED" && (
          <div className="flex flex-1 flex-col">
            <div className="text-center">
              <Lock className="mx-auto h-10 w-10 text-sky-700" />
              <h2 className="mt-3 text-3xl font-bold text-ink sm:text-5xl">Answers are locked</h2>
              <p className="mt-2 text-lg text-muted">Teams can now see their answer sheet. Marks are saved (max {s.maxMarks}); publish them from Results when ready.</p>
            </div>
            {showSheet && (
              <div className="mt-8 grid gap-6 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Answers</h3>
                  <ol className="space-y-2">
                    {s.questions.map((q, i) => (
                      <li key={q.id} className="rounded-xl bg-white/85 px-4 py-3">
                        <div className="text-sm text-ink">{i + 1}. {q.text}</div>
                        <div className="mt-1 text-lg font-bold tabular-nums text-emerald-700">{fmtNumber(q.answer)}</div>
                        {q.note && <div className="text-xs text-muted">{q.note}</div>}
                      </li>
                    ))}
                  </ol>
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">Standings</h3>
                  <ol className="space-y-2">
                    {s.standings.map((r) => (
                      <li key={r.teamId} className="flex items-center gap-3 rounded-xl bg-white/85 px-4 py-3">
                        <span className="w-8 text-lg font-bold tabular-nums text-muted">{r.rank}</span>
                        <span className="flex-1 truncate font-semibold text-ink">{r.name}</span>
                        <span className="text-xs text-muted">{r.answered}/{s.total} answered</span>
                        <span className="w-16 text-right text-lg font-bold tabular-nums text-ink">{r.points}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <footer className="mt-4 flex flex-wrap items-center gap-3">
        {s.phase === "NONE" && (
          <button type="button" disabled={busy || s.total === 0 || s.hasResults} onClick={() => run("open", -1)} className={`${cls.btn} ${cls.primary} px-8 py-3 text-base`}>Open lobby</button>
        )}
        {s.phase === "LOBBY" && (
          <button type="button" disabled={busy} onClick={() => go(1)} className={`${cls.btn} ${cls.primary} px-8 py-3 text-base`}>Show question 1</button>
        )}
        {s.phase === "QUESTION" && (
          <>
            <button type="button" disabled={busy || !canPrev} onClick={() => go(-1)} className={`${cls.btn} ${cls.secondary} px-5 py-3`}><ChevronLeft className="h-4 w-4" /> Previous</button>
            <button type="button" disabled={busy || !canNext} onClick={() => go(1)} className={`${cls.btn} ${cls.primary} px-6 py-3`}>Next <ChevronRight className="h-4 w-4" /></button>
            <span className="text-xs text-muted">← / → also work</span>
          </>
        )}
        {s.phase === "FINISHED" && (
          <button type="button" onClick={() => setShowSheet((v) => !v)} className={`${cls.btn} ${cls.primary} px-6 py-3`}>{showSheet ? "Hide answers and standings" : "Show answers and standings"}</button>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {(s.phase === "QUESTION" || s.phase === "LOBBY") && (
            <button type="button" disabled={busy} onClick={() => run("finish", s.index, "End the round and lock every team's answers? Teams then see a read-only answer sheet.")} className={`${cls.btn} ${cls.secondary}`}><Lock className="h-4 w-4" /> End round</button>
          )}
          {s.phase === "FINISHED" && (
            <button type="button" disabled={busy} onClick={() => run("reopen", s.index, "Reopen the round? Answers become editable again on the current question and saved marks are cleared until you end it again.")} className={`${cls.btn} ${cls.secondary}`}>Reopen</button>
          )}
          {(s.phase !== "NONE" || s.hasResults) && (
            <button type="button" disabled={busy} onClick={() => run("reset", s.index, "Reset the game? This deletes every answer and this round's marks. It cannot be undone.")} className={`${cls.btn} ${cls.danger}`}>Reset game</button>
          )}
        </div>
      </footer>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center text-center">{children}</div>;
}
