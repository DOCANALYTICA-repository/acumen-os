import "server-only";
import * as XLSX from "xlsx";
import type { Question } from "@prisma/client";
import { db, parseJson } from "./db";
import { excelKey, type ExcelKeyItem } from "./rounds";

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

export function excelItemCorrect(item: ExcelKeyItem, given: string | undefined) {
  const g = norm(given);
  if (!g) return false;
  const n = numericEqual(g, norm(item.value), item.tolerance || 0);
  return n ?? g === norm(item.value);
}

export function scoreExcel(key: ExcelKeyItem[], values: Record<string, string>) {
  return key.reduce((s, item) => s + (excelItemCorrect(item, values[item.cell]) ? item.marks : 0), 0);
}

/** Reads the given cells ("Sheet!B2" or "B2" = first sheet) out of an .xlsx buffer. */
export function readWorkbookCells(buf: Buffer, cells: string[]): Record<string, string> {
  const wb = XLSX.read(buf, { type: "buffer" });
  const out: Record<string, string> = {};
  for (const ref of cells) {
    const [sheetName, addr] = ref.includes("!") ? ref.split("!") : [wb.SheetNames[0], ref];
    const sheet = wb.Sheets[sheetName.replace(/^'|'$/g, "")];
    const cell = sheet?.[addr.toUpperCase()];
    out[ref] = cell ? String(cell.v ?? "") : "";
  }
  return out;
}

export function quizMax(questions: Pick<Question, "marks">[]) {
  return questions.reduce((s, q) => s + q.marks, 0);
}

export function excelMax(key: ExcelKeyItem[]) {
  return key.reduce((s, k) => s + k.marks, 0);
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
    db.round.findMany({ orderBy: { order: "asc" }, include: { questions: true, criteria: true } }),
    db.team.findMany({ where: { disqualified: false }, include: { members: { include: { user: true } } } }),
    db.attempt.findMany(),
    db.score.findMany(),
    db.resultOverride.findMany(),
  ]);

  const maxByRound: Record<string, number> = {};
  for (const r of rounds) {
    if (r.type === "QUIZ") maxByRound[r.id] = quizMax(r.questions);
    else if (r.type === "EXCEL") maxByRound[r.id] = excelMax(excelKey(r));
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
