"use client";

import { useEffect, useState } from "react";
import { Check, Flame, Trophy, X } from "lucide-react";
import type { PlayerState } from "@/lib/live-quiz-types";
import { SLOTS, Shape, TF_SLOTS, TYPE_HINT, TimerRing, answerText, fmtPoints, ordinal, postLive, secondsUntil, useLivePoll } from "@/components/live-quiz-ui";
import { cls } from "@/components/ui";

/** A team's answer pad for the host-led live quiz. */
export function LivePlayer({ roundId, initial }: { roundId: string; initial: PlayerState }) {
  const { state: s, error, now, refetch } = useLivePoll<PlayerState>(`/api/live/${roundId}`, initial);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [picks, setPicks] = useState<number[]>([]);
  const [text, setText] = useState("");

  // Fresh inputs for every question.
  useEffect(() => {
    setPicks([]);
    setText("");
    setProblem(null);
  }, [s.index]);

  async function send(answer: unknown) {
    if (sending) return;
    setSending(true);
    setProblem(null);
    try {
      const r = await postLive(roundId, { index: s.index, answer }); // null = no reply in time; the next poll shows whether it landed
      if (r && !r.ok) setProblem(r.error);
      await refetch();
    } finally {
      setSending(false);
    }
  }

  const preOpen = s.phase === "QUESTION" && (!s.question || (s.opensAt !== null && now !== null && now < s.opensAt));
  const timeUp = s.phase === "QUESTION" && s.endsAt !== null && now !== null && now >= s.endsAt;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="font-semibold text-ink">{s.teamName}</span>
        <span className="text-muted">
          {s.index >= 0 && s.phase !== "LOBBY" ? `Question ${s.index + 1} of ${s.total} · ` : ""}
          {fmtPoints(s.me.points)} pts{s.me.rank ? ` · ${ordinal(s.me.rank)}` : ""}
        </span>
      </div>
      {error && <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900" role="status">Reconnecting… ({error})</p>}

      {s.phase === "NONE" && (
        <Panel>
          <h2 className="text-2xl font-bold text-ink">Waiting for the host</h2>
          <p className="mt-2 text-muted">The quiz is run live from the main screen. Keep this page open; it joins you automatically when the organisers open the lobby.</p>
          <Pulse />
        </Panel>
      )}

      {s.phase === "LOBBY" && (
        <Panel>
          <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-8 w-8" /></div>
          <h2 className="text-3xl font-bold text-ink">You&apos;re in!</h2>
          <p className="mt-2 text-muted">{s.teamCount} {s.teamCount === 1 ? "team has" : "teams have"} joined. Watch the main screen; questions appear here when the host starts.</p>
          <ul className="mt-6 space-y-1 text-left text-sm text-ink/80">
            <li>• One answer per team. Whoever taps first locks it in for everyone.</li>
            <li>• Faster correct answers score more points.</li>
            <li>• Keep this tab open. Refreshing is safe.</li>
          </ul>
        </Panel>
      )}

      {preOpen && (
        <Panel>
          <p className="text-sm font-semibold uppercase tracking-wide text-muted">Question {s.index + 1} of {s.total}</p>
          <h2 className="mt-2 text-3xl font-bold text-ink">Get ready…</h2>
          <div className="mt-6 text-6xl font-bold tabular-nums text-sky-700">{secondsUntil(s.opensAt, now) ?? ""}</div>
        </Panel>
      )}

      {s.phase === "QUESTION" && s.question && !preOpen && (
        s.mine ? (
          <Panel>
            <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-sky-100 text-sky-700"><Check className="h-8 w-8" /></div>
            <h2 className="text-2xl font-bold text-ink">Answer locked in</h2>
            <p className="mt-2 text-muted">{s.mine.answeredBy} answered <strong className="text-ink">{answerText(s.question.type, s.question.options, s.mine.answer)}</strong>. Waiting for the other teams…</p>
          </Panel>
        ) : timeUp ? (
          <Panel><h2 className="text-2xl font-bold text-ink">Time&apos;s up</h2><p className="mt-2 text-muted">Revealing the answer…</p></Panel>
        ) : (
          <div>
            <div className="glass mb-4 flex items-center gap-4 rounded-2xl p-4">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">{TYPE_HINT[s.question.type]}{s.question.marks !== 1 ? ` · ${s.question.marks}× points` : ""}</p>
                <h2 className="mt-1 text-lg font-semibold leading-snug text-ink sm:text-xl">{s.question.text}</h2>
              </div>
              <TimerRing endsAt={s.endsAt} opensAt={s.opensAt} now={now} size={64} />
            </div>
            <AnswerPad s={s} sending={sending} picks={picks} setPicks={setPicks} text={text} setText={setText} send={send} />
            {problem && <p className="mt-3 text-center text-sm font-medium text-red-700" role="alert">{problem}</p>}
          </div>
        )
      )}

      {(s.phase === "REVEAL" || s.phase === "LEADERBOARD") && <Result s={s} />}

      {s.phase === "FINISHED" && (
        <Panel>
          <Trophy className="mx-auto h-12 w-12 text-amber-500" />
          <h2 className="mt-3 text-3xl font-bold text-ink">{s.me.rank ? `You finished ${ordinal(s.me.rank)}` : "Game over"}</h2>
          <p className="mt-1 text-lg text-muted">{fmtPoints(s.me.points)} points{s.teamCount ? ` · ${s.teamCount} teams` : ""}</p>
          <Top rows={s.top} me={s.teamName} />
          <p className="mt-6 text-sm text-muted">Your round marks appear on the dashboard once results are published.</p>
        </Panel>
      )}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="glass rounded-3xl p-8 text-center">{children}</div>;
}

function Pulse() {
  return <div className="mx-auto mt-6 h-3 w-3 animate-ping rounded-full bg-sky-500" aria-hidden />;
}

function AnswerPad({ s, sending, picks, setPicks, text, setText, send }: {
  s: PlayerState; sending: boolean; picks: number[]; setPicks: (p: number[]) => void; text: string; setText: (t: string) => void; send: (a: unknown) => void;
}) {
  const q = s.question!;
  if (q.type === "SHORT") {
    return (
      <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) send(text); }} className="space-y-3">
        <input autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={200} placeholder="Type your answer" className={`${cls.input} py-4 text-lg`} aria-label="Your answer" />
        <button type="submit" disabled={sending || !text.trim()} className={`${cls.btn} ${cls.primary} w-full py-4 text-lg`}>{sending ? "Sending…" : "Lock in answer"}</button>
      </form>
    );
  }
  const labels = q.type === "TRUEFALSE" ? ["True", "False"] : q.options;
  const slots = q.type === "TRUEFALSE" ? TF_SLOTS : SLOTS;
  const multi = q.type === "MULTI";
  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {labels.map((label, i) => {
          const slot = slots[i % slots.length];
          const on = picks.includes(i);
          return (
            <button
              key={i}
              type="button"
              disabled={sending}
              aria-pressed={multi ? on : undefined}
              onClick={() => {
                if (!multi) return send(q.type === "TRUEFALSE" ? i === 0 : i);
                setPicks(on ? picks.filter((x) => x !== i) : [...picks, i]);
              }}
              className={`flex min-h-20 items-center gap-3 rounded-2xl px-5 py-4 text-left text-lg font-semibold text-white shadow-soft transition active:scale-[0.98] disabled:opacity-60 ${slot.bg} ${multi && on ? "ring-4 ring-ink ring-offset-2" : ""} ${multi && !on && picks.length ? "opacity-70" : ""}`}
            >
              <Shape shape={slot.shape} className="h-7 w-7 shrink-0" />
              <span className="flex-1">{label}</span>
              {multi && on && <Check className="h-6 w-6 shrink-0" />}
            </button>
          );
        })}
      </div>
      {multi && (
        <button type="button" disabled={sending || !picks.length} onClick={() => send(picks)} className={`${cls.btn} ${cls.primary} mt-4 w-full py-4 text-lg`}>
          {sending ? "Sending…" : `Lock in ${picks.length || ""} answer${picks.length === 1 ? "" : "s"}`}
        </button>
      )}
    </div>
  );
}

function Result({ s }: { s: PlayerState }) {
  const q = s.question;
  const answered = !!s.mine;
  const right = s.mine?.correct === true;
  return (
    <div className={`rounded-3xl p-8 text-center text-white shadow-soft ${!answered ? "bg-slate-600" : right ? "bg-emerald-600" : "bg-rose-600"}`}>
      <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-full bg-white/20">{right ? <Check className="h-9 w-9" /> : <X className="h-9 w-9" />}</div>
      <h2 className="text-3xl font-bold">{!answered ? "No answer" : right ? "Correct!" : "Not quite"}</h2>
      {right && <p className="mt-2 text-2xl font-bold tabular-nums">+{fmtPoints(s.mine?.points ?? 0)}</p>}
      {right && (s.mine?.streak ?? 0) >= 2 && <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-sm font-semibold"><Flame className="h-4 w-4" /> {s.mine?.streak} in a row</p>}
      {q && !right && <p className="mt-3 text-white/90">Answer: <strong>{answerText(q.type, q.options, s.correctAnswer)}</strong></p>}
      <p className="mt-6 text-lg font-semibold">{s.me.rank ? `You're ${ordinal(s.me.rank)} of ${s.teamCount} · ` : ""}{fmtPoints(s.me.points)} pts</p>
      {s.phase === "LEADERBOARD" && <div className="mt-6 rounded-2xl bg-white p-4 text-left text-ink"><Top rows={s.top} me={s.teamName} /></div>}
    </div>
  );
}

function Top({ rows, me }: { rows: PlayerState["top"]; me: string }) {
  if (!rows.length) return null;
  return (
    <ol className="mt-4 space-y-1.5 text-left">
      {rows.map((r) => (
        <li key={r.teamId} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${r.name === me ? "bg-sky-100 font-semibold" : "bg-white/70"}`}>
          <span className="w-6 tabular-nums text-muted">{r.rank}</span>
          <span className="flex-1 truncate text-ink">{r.name}</span>
          <span className="tabular-nums text-ink">{fmtPoints(r.points)}</span>
        </li>
      ))}
    </ol>
  );
}
