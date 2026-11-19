"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Flame, Maximize2, Trophy, Users } from "lucide-react";
import type { HostState, LiveResult, StandingRow } from "@/lib/live-quiz-types";
import { SLOTS, Shape, TF_SLOTS, TYPE_HINT, TimerRing, answerText, fmtPoints, ordinal, postLive, secondsUntil, useLivePoll } from "@/components/live-quiz-ui";
import { cls } from "@/components/ui";

export function HostScreen({ roundId, roundName, roundOrder, initial }: { roundId: string; roundName: string; roundOrder: number; initial: HostState }) {
  const { state: s, error, now, refetch } = useLivePoll<HostState>(`/api/live/${roundId}?view=host`, initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const run = useCallback(
    async (fn: () => Promise<LiveResult | null>, confirmText?: string) => {
      if (busy || (confirmText && !window.confirm(confirmText))) return;
      setBusy(true);
      setMsg(null);
      try {
        const r = await fn(); // null = no reply in time; the next poll shows what happened
        if (r && !r.ok) setMsg(r.error);
        await refetch();
      } finally {
        setBusy(false);
      }
    },
    [busy, refetch],
  );
  const cmd = useCallback((command: string, index: number) => () => postLive(roundId, { command, index }), [roundId]);

  const preOpen = s.phase === "QUESTION" && s.opensAt !== null && now !== null && now < s.opensAt;
  const isLast = s.index + 1 >= s.total;

  const { phase, index } = s;
  const primary = useMemo<{ label: string; act: () => Promise<LiveResult | null> } | null>(
    () =>
      phase === "NONE" ? { label: "Open lobby", act: cmd("open", -1) }
      : phase === "LOBBY" ? { label: "Start quiz", act: cmd("next", -1) }
      : phase === "QUESTION" ? { label: "Show answer now", act: cmd("reveal", index) }
      : phase === "REVEAL" ? { label: "Show leaderboard", act: cmd("leaderboard", index) }
      : phase === "LEADERBOARD" ? { label: isLast ? "Finish and show podium" : "Next question", act: cmd("next", index) }
      : null,
    [phase, index, isLast, cmd],
  );

  // Space / Enter / → drives the game from a clicker or keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!primary || (e.target as HTMLElement)?.closest("input,textarea,select,button")) return;
      if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") {
        e.preventDefault();
        void run(primary.act);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [primary, run]);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-10rem)] max-w-7xl flex-col px-4 pb-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Live quiz host</div>
          <h1 className="truncate text-xl font-bold text-ink">{roundName}</h1>
        </div>
        {s.phase !== "NONE" && s.phase !== "LOBBY" && s.index >= 0 && (
          <span className="rounded-full bg-white/80 px-3 py-1 text-sm font-semibold text-ink shadow-soft">Question {s.index + 1} / {s.total}</span>
        )}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/80 px-3 py-1 text-sm font-semibold text-ink shadow-soft"><Users className="h-4 w-4" /> {s.teams.length} teams</span>
        <button type="button" onClick={() => document.documentElement.requestFullscreen?.()} className={`${cls.btn} ${cls.secondary}`} title="Full screen" aria-label="Full screen"><Maximize2 className="h-4 w-4" /></button>
        <Link href={`/admin/rounds/${roundId}`} className={`${cls.btn} ${cls.secondary}`}>Round settings</Link>
      </header>

      {(error || msg) && <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800" role="alert">{msg ?? `Connection problem: ${error}. Retrying…`}</p>}

      <section className="glass flex flex-1 flex-col rounded-3xl p-6 sm:p-10">
        {s.phase === "NONE" && (
          <Center>
            <h2 className="text-4xl font-bold text-ink sm:text-5xl">Ready to play?</h2>
            <p className="mt-3 text-lg text-muted">{s.total} questions. Opening the lobby lets teams join from their phones or laptops.</p>
            {s.total === 0 && <p className="mt-4 text-red-700">Add questions on the round settings page first.</p>}
            {s.hasResults && <p className="mt-4 max-w-xl text-amber-800">This round already has quiz marks from an earlier game. Reset the game to clear them before opening a new lobby.</p>}
          </Center>
        )}

        {s.phase === "LOBBY" && (
          <div className="flex flex-1 flex-col">
            <div className="text-center">
              <p className="text-lg text-muted">Join now</p>
              <h2 className="mt-1 text-3xl font-bold text-ink sm:text-5xl">Sign in at <span className="text-sky-700">{origin.replace(/^https?:\/\//, "") || "the Acumen site"}</span></h2>
              <p className="mt-3 text-lg text-muted sm:text-xl">Then open <strong className="text-ink">Dashboard → Round {roundOrder}</strong>. One answer per team: the first teammate to tap counts.</p>
            </div>
            <div className="mt-10 flex items-center justify-center gap-3 text-2xl font-bold text-ink"><Users className="h-7 w-7" /> {s.teams.length} {s.teams.length === 1 ? "team" : "teams"} joined</div>
            <ul className="mt-6 flex flex-wrap justify-center gap-3">
              {s.teams.map((t, i) => (
                <li key={t.id} className={`rounded-full px-5 py-2 text-lg font-semibold text-white shadow-soft ${SLOTS[i % SLOTS.length].bg}`}>{t.name}</li>
              ))}
            </ul>
            {s.teams.length === 0 && <p className="mt-6 text-center text-muted">Waiting for the first team…</p>}
          </div>
        )}

        {s.phase === "QUESTION" && s.question && (
          preOpen ? (
            <Center>
              <p className="text-xl font-semibold uppercase tracking-wide text-muted">Question {s.index + 1} of {s.total} · {TYPE_HINT[s.question.type]}</p>
              <h2 className="mt-4 max-w-4xl text-3xl font-bold text-ink sm:text-5xl">{s.question.text}</h2>
              <div className="mt-8 text-7xl font-bold tabular-nums text-sky-700">{secondsUntil(s.opensAt, now)}</div>
            </Center>
          ) : (
            <div className="flex flex-1 flex-col">
              <div className="flex items-start gap-6">
                <h2 className="flex-1 text-2xl font-bold leading-tight text-ink sm:text-4xl">{s.question.text}</h2>
                <TimerRing endsAt={s.endsAt} opensAt={s.opensAt} now={now} size={110} />
              </div>
              <div className="my-6 text-center text-xl font-semibold text-muted">
                <span className="text-4xl font-bold tabular-nums text-ink">{s.answered}</span> / {s.teams.length} answered
              </div>
              <OptionGrid q={s.question} />
            </div>
          )
        )}

        {s.phase === "REVEAL" && s.question && <Reveal s={s} />}

        {s.phase === "LEADERBOARD" && (
          <div className="flex flex-1 flex-col">
            <h2 className="mb-6 text-center text-3xl font-bold text-ink sm:text-4xl">Leaderboard</h2>
            <ol className="mx-auto w-full max-w-3xl space-y-3">
              {s.standings.slice(0, 5).map((r) => <StandingLine key={r.teamId} r={r} />)}
            </ol>
            {s.standings.length > 5 && <p className="mt-4 text-center text-muted">+ {s.standings.length - 5} more teams</p>}
            {s.nextQuestion && <p className="mt-auto pt-6 text-center text-sm text-muted">Up next: question {s.index + 2} · {TYPE_HINT[s.nextQuestion.type]}</p>}
          </div>
        )}

        {s.phase === "FINISHED" && <Podium rows={s.standings} />}
      </section>

      <footer className="mt-4 flex flex-wrap items-center gap-3">
        {primary && (
          <button type="button" disabled={busy || (s.phase === "NONE" && (s.total === 0 || s.hasResults))} onClick={() => run(primary.act)} className={`${cls.btn} ${cls.primary} px-8 py-3 text-base`}>
            {busy ? "Working…" : primary.label}
          </button>
        )}
        {primary && <span className="text-xs text-muted">Space or → also works</span>}
        <div className="ml-auto flex flex-wrap gap-2">
          {s.phase !== "NONE" && s.phase !== "FINISHED" && (
            <button type="button" disabled={busy} onClick={() => run(cmd("finish", s.index), "End the game now? Teams keep the points they have and marks are saved.")} className={`${cls.btn} ${cls.secondary}`}>End game now</button>
          )}
          {(s.phase !== "NONE" || s.hasResults) && (
            <button type="button" disabled={busy} onClick={() => run(cmd("reset", s.index), "Reset the game? This deletes every answer and this round's quiz marks. It cannot be undone.")} className={`${cls.btn} ${cls.danger}`}>Reset game</button>
          )}
        </div>
      </footer>
      {s.phase === "FINISHED" && <p className="mt-2 text-sm text-muted">Marks are saved to results (1,000 points = 1 mark, max {s.maxMarks}). Publish them from Results when ready.</p>}
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col items-center justify-center text-center">{children}</div>;
}

function slotsFor(type: string) {
  return type === "TRUEFALSE" ? TF_SLOTS : SLOTS;
}

function labelsFor(q: { type: string; options: string[] }) {
  if (q.type === "TRUEFALSE") return ["True", "False"];
  if (q.type === "SHORT") return ["Correct", "Wrong"];
  return q.options;
}

function OptionGrid({ q }: { q: { type: string; options: string[] } }) {
  if (q.type === "SHORT") return <p className="mt-auto rounded-2xl bg-white/70 p-6 text-center text-2xl font-semibold text-muted">Teams are typing their answers…</p>;
  const slots = slotsFor(q.type);
  return (
    <ul className="mt-auto grid gap-3 sm:grid-cols-2">
      {labelsFor(q).map((label, i) => (
        <li key={i} className={`flex min-h-20 items-center gap-4 rounded-2xl px-5 py-4 text-xl font-semibold text-white shadow-soft sm:text-2xl ${slots[i % slots.length].bg}`}>
          <Shape shape={slots[i % slots.length].shape} className="h-8 w-8 shrink-0" />
          <span>{label}</span>
        </li>
      ))}
    </ul>
  );
}

function isCorrectSlot(type: string, answer: unknown, i: number) {
  if (type === "SINGLE") return answer === i;
  if (type === "MULTI") return Array.isArray(answer) && answer.includes(i);
  if (type === "TRUEFALSE") return (i === 0) === answer;
  return i === 0;
}

function Reveal({ s }: { s: HostState }) {
  const q = s.question!;
  const counts = s.distribution ?? [];
  const labels = labelsFor(q);
  const slots = slotsFor(q.type);
  const top = Math.max(1, ...counts);
  return (
    <div className="flex flex-1 flex-col">
      <h2 className="text-center text-2xl font-bold text-ink sm:text-3xl">{q.text}</h2>
      <p className="mt-2 text-center text-lg text-muted">
        Answer: <strong className="text-emerald-700">{answerText(q.type, q.options, q.answer)}</strong> · {s.correctCount} of {s.teams.length} teams correct
      </p>
      <div className="mx-auto mt-8 flex h-48 w-full max-w-4xl items-end justify-center gap-4 lg:h-64">
        {labels.map((label, i) => {
          const right = isCorrectSlot(q.type, q.answer, i);
          return (
            <div key={i} className="flex h-full flex-1 flex-col items-center justify-end" title={`${label}: ${counts[i] ?? 0}`}>
              <span className="mb-1 text-2xl font-bold tabular-nums text-ink">{counts[i] ?? 0}</span>
              <div className={`w-full max-w-36 rounded-t-xl ${slots[i % slots.length].bg} ${right ? "" : "opacity-35"}`} style={{ height: `${Math.max(4, ((counts[i] ?? 0) / top) * 100)}%` }} />
              <div className={`mt-2 flex w-full max-w-36 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-sm font-semibold ${right ? "bg-emerald-600 text-white" : "bg-white/70 text-muted"}`}>
                {right ? <Check className="h-4 w-4 shrink-0" /> : <Shape shape={slots[i % slots.length].shape} className="h-4 w-4 shrink-0" />}
                <span className="truncate">{label}</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-6 text-center text-sm text-muted">{s.answered} of {s.teams.length} teams answered</p>
    </div>
  );
}

function StandingLine({ r }: { r: StandingRow }) {
  return (
    <li className="flex items-center gap-4 rounded-2xl bg-white/85 px-5 py-4 shadow-soft">
      <span className="w-10 text-2xl font-bold tabular-nums text-muted">{r.rank}</span>
      <span className="flex-1 truncate text-xl font-semibold text-ink">{r.name}</span>
      {r.streak >= 2 && <span className="inline-flex items-center gap-1 text-sm font-semibold text-orange-600"><Flame className="h-4 w-4" />{r.streak}</span>}
      {r.gained > 0 && <span className="text-sm font-semibold text-emerald-700">+{fmtPoints(r.gained)}</span>}
      <span className="w-28 text-right text-2xl font-bold tabular-nums text-ink">{fmtPoints(r.points)}</span>
    </li>
  );
}

function Podium({ rows }: { rows: StandingRow[] }) {
  const top = rows.slice(0, 3);
  const order = [top[1], top[0], top[2]];
  const heights = ["h-40", "h-56", "h-28"];
  const tint = ["bg-slate-400", "bg-amber-400", "bg-orange-400"];
  return (
    <div className="flex flex-1 flex-col">
      <h2 className="text-center text-3xl font-bold text-ink sm:text-5xl"><Trophy className="mr-2 inline h-10 w-10 text-amber-500" />Final results</h2>
      <div className="mx-auto mt-10 flex w-full max-w-3xl items-end justify-center gap-4">
        {order.map((r, i) =>
          r ? (
            <div key={r.teamId} className="flex flex-1 flex-col items-center">
              <span className="mb-2 text-center text-lg font-bold text-ink sm:text-2xl">{r.name}</span>
              <span className="mb-2 text-sm font-semibold tabular-nums text-muted">{fmtPoints(r.points)} pts</span>
              <div className={`flex w-full items-start justify-center rounded-t-2xl pt-3 text-3xl font-bold text-white ${heights[i]} ${tint[i]}`}>{ordinal(r.rank)}</div>
            </div>
          ) : <div key={i} className="flex-1" />,
        )}
      </div>
      {rows.length > 3 && (
        <ol className="mx-auto mt-8 w-full max-w-3xl space-y-2">
          {rows.slice(3, 10).map((r) => <StandingLine key={r.teamId} r={r} />)}
        </ol>
      )}
      {rows.length === 0 && <p className="mt-8 text-center text-muted">No teams joined this game.</p>}
    </div>
  );
}
