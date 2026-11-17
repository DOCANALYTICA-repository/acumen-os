"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { logTabSwitch, saveAnswer, submitAttempt } from "@/app/actions/rounds";
import { cls } from "@/components/ui";

export type ClientQuestion = { id: string; type: string; text: string; options: { index: number; label: string }[]; marks: number; negativeMarks: number };
type Answer = number | number[] | boolean | string | null;

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function QuizClient({ roundId, questions, initial, deadline }: { roundId: string; questions: ClientQuestion[]; initial: Record<string, Answer>; deadline: number | null }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, Answer>>(initial);
  const [review, setReview] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState(0);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const submitted = useRef(false);

  const finish = useCallback(async () => {
    if (submitted.current) return;
    submitted.current = true;
    await submitAttempt(roundId);
    router.refresh();
  }, [roundId, router]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (deadline && now >= deadline) void finish();
  }, [now, deadline, finish]);
  useEffect(() => {
    const onVis = () => document.visibilityState === "hidden" && void logTabSwitch(roundId);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [roundId]);

  async function set(qid: string, value: Answer) {
    setAnswers((a) => ({ ...a, [qid]: value }));
    setSaving("saving");
    const res = await saveAnswer(roundId, qid, value);
    if (res.ok) setSaving("saved");
    else {
      setSaving("error");
      setError(res.error);
      router.refresh();
    }
  }

  const answered = useMemo(() => questions.filter((q) => {
    const v = answers[q.id];
    return v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
  }).length, [answers, questions]);

  const q = questions[current];
  const value = answers[q.id];
  const left = deadline ? deadline - now : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
      <div className="rounded-xl border border-line bg-white p-6 shadow-sm select-none" onCopy={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()}>
        <div className="mb-4 flex items-center justify-between text-sm text-muted">
          <span>Question {current + 1} of {questions.length} · {q.marks} mark{q.marks === 1 ? "" : "s"}{q.negativeMarks ? ` · −${q.negativeMarks} if wrong` : ""}</span>
          <span>{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : saving === "error" ? error : ""}</span>
        </div>
        <p className="text-lg font-medium text-ink">{q.text}</p>
        <div className="mt-5 space-y-2">
          {q.type === "SINGLE" && q.options.map((o) => (
            <label key={o.index} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${value === o.index ? "border-brand bg-brand/5" : "border-line"}`}>
              <input type="radio" name={q.id} checked={value === o.index} onChange={() => set(q.id, o.index)} />
              <span className="text-sm">{o.label}</span>
            </label>
          ))}
          {q.type === "MULTI" && q.options.map((o) => {
            const arr = Array.isArray(value) ? value : [];
            const on = arr.includes(o.index);
            return (
              <label key={o.index} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${on ? "border-brand bg-brand/5" : "border-line"}`}>
                <input type="checkbox" checked={on} onChange={() => set(q.id, on ? arr.filter((x) => x !== o.index) : [...arr, o.index])} />
                <span className="text-sm">{o.label}</span>
              </label>
            );
          })}
          {q.type === "TRUEFALSE" && [true, false].map((b) => (
            <label key={String(b)} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 ${value === b ? "border-brand bg-brand/5" : "border-line"}`}>
              <input type="radio" name={q.id} checked={value === b} onChange={() => set(q.id, b)} />
              <span className="text-sm">{b ? "True" : "False"}</span>
            </label>
          ))}
          {q.type === "SHORT" && (
            <input key={q.id} defaultValue={typeof value === "string" ? value : ""} onBlur={(e) => set(q.id, e.target.value.trim())} className={cls.input} placeholder="Type your answer" />
          )}
        </div>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <button className={`${cls.btn} ${cls.secondary}`} disabled={current === 0} onClick={() => setCurrent((c) => c - 1)}>Previous</button>
            <button className={`${cls.btn} ${cls.secondary}`} disabled={current === questions.length - 1} onClick={() => setCurrent((c) => c + 1)}>Next</button>
          </div>
          <button
            className={`${cls.btn} ${cls.secondary}`}
            onClick={() => setReview((r) => { const n = new Set(r); if (n.has(q.id)) n.delete(q.id); else n.add(q.id); return n; })}
          >
            {review.has(q.id) ? "Unmark review" : "Mark for review"}
          </button>
        </div>
      </div>

      <aside className="space-y-4">
        {left !== null && (
          <div className={`rounded-xl p-4 text-center ${left < 60_000 ? "bg-red-600 text-white" : "bg-ink text-white"}`}>
            <div className="text-xs uppercase tracking-wider opacity-70">Time left</div>
            <div className="font-mono text-3xl font-bold tabular-nums">{fmt(left)}</div>
          </div>
        )}
        <div className="rounded-xl border border-line bg-white p-4">
          <div className="mb-3 text-sm font-medium text-ink">{answered} of {questions.length} answered</div>
          <div className="grid grid-cols-5 gap-2">
            {questions.map((qq, i) => {
              const v = answers[qq.id];
              const done = v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0);
              return (
                <button key={qq.id} onClick={() => setCurrent(i)}
                  className={`h-9 rounded-md text-sm font-semibold ${i === current ? "ring-2 ring-brand" : ""} ${review.has(qq.id) ? "bg-amber-200 text-amber-900" : done ? "bg-emerald-600 text-white" : "bg-surface text-ink"}`}>
                  {i + 1}
                </button>
              );
            })}
          </div>
          <div className="mt-3 space-y-1 text-xs text-muted">
            <div><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-emerald-600" />Answered</div>
            <div><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-amber-300" />Marked for review</div>
          </div>
        </div>
        <button className={`${cls.btn} ${cls.primary} w-full`} onClick={() => {
          if (window.confirm(`Submit the quiz? ${questions.length - answered} question(s) unanswered. You cannot change answers after this.`)) void finish();
        }}>Submit quiz</button>
      </aside>
    </div>
  );
}
