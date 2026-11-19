/** Client-safe types and helpers for the host-led live quiz. */

export type LivePhase = "NONE" | "LOBBY" | "QUESTION" | "REVEAL" | "LEADERBOARD" | "FINISHED";

export type LiveResult = { ok: true } | { ok: false; error: string };

/** Seconds of "get ready" shown before each question accepts answers. */
export const READY_SECONDS = 4;

export type LiveQuestionView = {
  id: string;
  type: string; // SINGLE | MULTI | TRUEFALSE | SHORT
  text: string;
  options: string[];
  timeLimit: number;
  marks: number;
};

export type StandingRow = { teamId: string; name: string; points: number; rank: number; gained: number; streak: number };

export type HostState = {
  phase: LivePhase;
  serverNow: number;
  opensAt: number | null;
  endsAt: number | null;
  index: number;
  total: number;
  question: (LiveQuestionView & { answer: unknown }) | null;
  nextQuestion: { text: string; type: string } | null;
  teams: { id: string; name: string }[];
  answered: number;
  /** Per option for choice questions ([true, false] for true/false); [correct, wrong] for short answer. */
  distribution: number[] | null;
  correctCount: number;
  standings: StandingRow[];
  maxMarks: number;
  /** Quiz marks already exist for this round (e.g. from an earlier game) and must be reset before a new lobby. */
  hasResults: boolean;
};

export type PlayerState = {
  phase: LivePhase;
  serverNow: number;
  opensAt: number | null;
  endsAt: number | null;
  index: number;
  total: number;
  teamName: string;
  teamCount: number;
  question: LiveQuestionView | null;
  mine: { answer: unknown; answeredBy: string; correct: boolean | null; points: number | null; streak: number | null } | null;
  correctAnswer: unknown;
  me: { points: number; rank: number | null; gained: number; streak: number };
  top: StandingRow[];
};

/** Kahoot-style speed scoring: a correct answer is worth 1000 × marks at once, falling to half at the buzzer. */
export function speedPoints(marks: number, ms: number, limitSeconds: number) {
  const f = Math.min(1, Math.max(0, ms / (limitSeconds * 1000)));
  return Math.round(1000 * marks * (1 - f / 2));
}

export function optionLetter(i: number) {
  return String.fromCharCode(65 + i);
}
