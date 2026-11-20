/** Client-safe types and scoring for the host-led guesstimate round (Round 1). */

export type LivePhase = "NONE" | "LOBBY" | "QUESTION" | "FINISHED";

export type LiveResult = { ok: true } | { ok: false; error: string };

/** Points by how far a guess is from the correct answer: within 5% = 3, within 10% = 2, within 20% = 1, else 0. */
export const GUESS_TIERS: { withinPct: number; points: number }[] = [
  { withinPct: 5, points: 3 },
  { withinPct: 10, points: 2 },
  { withinPct: 20, points: 1 },
];
export const MAX_GUESS_POINTS = GUESS_TIERS[0].points;

/** Percentage error of a guess (0 = exact). A correct answer of 0 only accepts 0. */
export function guessErrorPct(guess: number, correct: number) {
  if (correct === 0) return guess === 0 ? 0 : Infinity;
  return (Math.abs(guess - correct) / Math.abs(correct)) * 100;
}

export function guessPoints(guess: number, correct: number) {
  const err = guessErrorPct(guess, correct);
  return GUESS_TIERS.find((t) => err <= t.withinPct + 1e-9)?.points ?? 0;
}

/** Accepts "12,500", "1.2e6", " 42 " etc. Returns null when it is not a finite number. */
export function parseGuess(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[,\s_]/g, "");
  if (!cleaned || !/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function fmtNumber(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 6 });
}

export type StandingRow = { teamId: string; name: string; points: number; rank: number; answered: number };

export type HostQuestion = { id: string; text: string; answer: number | null; note: string };

export type HostState = {
  phase: LivePhase;
  serverNow: number;
  index: number;
  total: number;
  question: HostQuestion | null;
  /** Every question in play order, for jumping around and the end-of-game answer sheet. */
  questions: HostQuestion[];
  teams: { id: string; name: string }[];
  /** Teams that have saved an answer for the current question. */
  saved: number;
  standings: StandingRow[];
  maxMarks: number;
  /** Marks already exist for this round (e.g. from an earlier game) and must be reset before a new lobby. */
  hasResults: boolean;
};

export type ReviewRow = { index: number; text: string; value: number | null; correct: number | null; points: number | null };

export type PlayerState = {
  phase: LivePhase;
  serverNow: number;
  index: number;
  total: number;
  teamName: string;
  teamCount: number;
  question: { id: string; text: string } | null;
  /** The team's saved answer for the current question. */
  mine: { value: number; savedBy: string; savedAt: number } | null;
  answeredCount: number;
  /** Read-only answer sheet once the host ends the round; correct answers and points only after results are published. */
  review: ReviewRow[];
  resultsPublished: boolean;
};
