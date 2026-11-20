import "server-only";
import type { Question } from "@prisma/client";
import { db, parseJson } from "./db";
import { manualSettings } from "./rounds";
import { parseConfig } from "./sim/model";
import { guessPoints, MAX_GUESS_POINTS } from "./live-quiz-types";

export type QuizAnswer = number | number[] | boolean | string | null;

function norm(v: unknown) {
  return String(v ?? "").trim().toLowerCase();
}

function numericEqual(a: string, b: string, tolerance: number) {
  const x = Number(a.replace(/,/g, ""));
  const y = Number(b.replace(/,/g, ""));
  if (a === "" || b === "" || Number.isNaN(x) || Number.isNaN(y)) return null;
  return Math.abs(x - y) <= tolerance + 1e-9;
}

export function isQuizAnswerCorrect(q: Pick<Question, "type" | "answer">, given: QuizAnswer): boolean {
  const correct = parseJson<QuizAnswer>(q.answer, null);
  switch (q.type) {
    case "SINGLE":
      return typeof given === "number" && given === correct;
    case "MULTI": {
      if (!Array.isArray(given) || !Array.isArray(correct)) return false;
      const a = [...given].sort().join(",");
      const b = [...correct].sort().join(",");
      return a === b;
    }
    case "TRUEFALSE":
      return typeof given === "boolean" && given === correct;
    case "SHORT": {
      const n = numericEqual(norm(given), norm(correct), 0);
      return n ?? norm(given) === norm(correct);
    }
    case "NUMBER": // guesstimate: "correct" = scored any points (within 20%)
      return typeof given === "number" && typeof correct === "number" && guessPoints(given, correct) > 0;
    default:
      return false;
  }
}

function isAnswered(v: QuizAnswer) {
  if (v === null || v === undefined || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function scoreQuiz(questions: Question[], answers: Record<string, QuizAnswer>) {
  let score = 0;
  for (const q of questions) {
    const given = answers[q.id];
    if (!isAnswered(given)) continue;
    score += isQuizAnswerCorrect(q, given) ? q.marks : -q.negativeMarks;
  }
  return Math.max(0, score);
}

/** Guesstimate rounds: every question is worth up to 3 points. */
export function quizMax(questions: Pick<Question, "marks">[]) {
  return questions.length * MAX_GUESS_POINTS;
}

export type LeaderboardRow = {
  teamId: string;
  teamName: string;
  college: string;
  perRound: Record<string, number | null>; // percentage 0-100
  overall: number;
  rank: number;
};

/** Per-round percentage scores and the weighted overall score for every eligible team. */
export async function computeLeaderboard() {
  const [rounds, teams, attempts, scores, overrides] = await Promise.all([
    db.round.findMany({ orderBy: { order: "asc" }, include: { questions: true, criteria: true, economy: { select: { config: true } } } }),
    db.team.findMany({ where: { disqualified: false }, include: { members: { include: { user: true } } } }),
    db.attempt.findMany(),
    db.score.findMany(),
    db.resultOverride.findMany(),
  ]);

  const maxByRound: Record<string, number> = {};
  for (const r of rounds) {
    if (r.type === "QUIZ") maxByRound[r.id] = quizMax(r.questions);
    else if (r.type === "SIMULATION") maxByRound[r.id] = parseConfig(r.economy?.config).scoring.maxMarks;
    else if (r.type === "MANUAL") maxByRound[r.id] = manualSettings(r).maxMarks;
    else maxByRound[r.id] = r.criteria.reduce((s, c) => s + c.maxMarks, 0);
  }

  const pct = (raw: number, max: number) => (max > 0 ? Math.min(100, (raw / max) * 100) : 0);
  const totalWeight = rounds.reduce((s, r) => s + r.weight, 0) || 1;

  const rows: LeaderboardRow[] = teams.map((t) => {
    const perRound: Record<string, number | null> = {};
    for (const r of rounds) {
      const ov = overrides.find((o) => o.roundId === r.id && o.teamId === t.id);
      if (ov) {
        perRound[r.id] = ov.score;
        continue;
      }
      if (r.type === "SUBMISSION") {
        const s = scores.filter((x) => x.roundId === r.id && x.teamId === t.id);
        const judges = [...new Set(s.map((x) => x.judgeId))];
        perRound[r.id] = judges.length
          ? pct(judges.reduce((sum, j) => sum + s.filter((x) => x.judgeId === j).reduce((a, b) => a + b.marks, 0), 0) / judges.length, maxByRound[r.id])
          : null;
      } else if (r.type === "MANUAL") {
        // Off-platform: only the organisers' marks count, whether or not the team clicked "done".
        const a = attempts.find((x) => x.roundId === r.id && x.teamId === t.id);
        perRound[r.id] = a?.manualScore != null ? pct(a.manualScore, maxByRound[r.id]) : null;
      } else {
        const a = attempts.find((x) => x.roundId === r.id && x.teamId === t.id && x.submittedAt);
        perRound[r.id] = a ? pct((a.autoScore ?? 0) + (a.manualScore ?? 0), maxByRound[r.id]) : null;
      }
    }
    const overall = rounds.reduce((s, r) => s + (perRound[r.id] ?? 0) * r.weight, 0) / totalWeight;
    const lead = t.members.find((m) => m.isLead) ?? t.members[0];
    return { teamId: t.id, teamName: t.name, college: lead?.user.college ?? "", perRound, overall, rank: 0 };
  });

  rows.sort((a, b) => b.overall - a.overall);
  rows.forEach((r, i) => (r.rank = i > 0 && Math.abs(r.overall - rows[i - 1].overall) < 1e-9 ? rows[i - 1].rank : i + 1));
  return { rounds, rows, maxByRound };
}

/** Rank teams by a single round's score (for cut-offs). */
export function rankByRound(rows: LeaderboardRow[], roundId: string) {
  return [...rows]
    .filter((r) => r.perRound[roundId] !== null)
    .sort((a, b) => (b.perRound[roundId] ?? 0) - (a.perRound[roundId] ?? 0));
}
