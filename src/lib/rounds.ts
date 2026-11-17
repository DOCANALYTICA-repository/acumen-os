import type { Round, Team } from "@prisma/client";
import { parseJson } from "./db";

export type RoundType = "QUIZ" | "EXCEL" | "SUBMISSION";
export type EffectiveStatus = "DRAFT" | "UPCOMING" | "LIVE" | "CLOSED";

export type SubmissionSettings = {
  allowedTypes: string[]; // file extensions without dot
  maxSizeMB: number;
  maxFiles: number;
  allowResubmit: boolean;
  allowLate: boolean;
  latePenaltyPct: number;
  allowLinks: boolean;
  anonymousJudging: boolean;
};

export const DEFAULT_SUBMISSION_SETTINGS: SubmissionSettings = {
  allowedTypes: ["pdf", "pptx"],
  maxSizeMB: 25,
  maxFiles: 1,
  allowResubmit: true,
  allowLate: false,
  latePenaltyPct: 0,
  allowLinks: false,
  anonymousJudging: true,
};

export const ALL_FILE_TYPES = ["pdf", "ppt", "pptx", "doc", "docx", "xls", "xlsx", "csv", "zip", "mp4", "png", "jpg", "jpeg"];

export type ExcelKeyItem = { cell: string; label: string; value: string; tolerance: number; marks: number };

export function submissionSettings(round: Pick<Round, "settings">): SubmissionSettings {
  return { ...DEFAULT_SUBMISSION_SETTINGS, ...parseJson<Partial<SubmissionSettings>>(round.settings, {}) };
}

export function excelKey(round: Pick<Round, "excelAnswerKey">): ExcelKeyItem[] {
  return parseJson<ExcelKeyItem[]>(round.excelAnswerKey, []);
}

export function effectiveStatus(round: Pick<Round, "status" | "startsAt" | "endsAt">, now = new Date()): EffectiveStatus {
  if (round.status === "DRAFT") return "DRAFT";
  if (round.status === "CLOSED") return "CLOSED";
  if (round.endsAt && now > round.endsAt) return "CLOSED";
  if (round.status === "LIVE") return "LIVE";
  if (round.startsAt && now < round.startsAt) return "UPCOMING";
  return round.startsAt ? "LIVE" : "UPCOMING";
}

export const TYPE_LABEL: Record<string, string> = { QUIZ: "Quiz", EXCEL: "Excel", SUBMISSION: "Submission" };

export type TeamStatus = "INCOMPLETE" | "COMPLETE" | "PAID" | "PAYMENT_REJECTED" | "DISQUALIFIED";

export function teamStatus(team: Pick<Team, "paymentStatus" | "disqualified">, memberCount: number, teamMin: number): TeamStatus {
  if (team.disqualified) return "DISQUALIFIED";
  if (memberCount < teamMin) return "INCOMPLETE";
  if (team.paymentStatus === "REJECTED") return "PAYMENT_REJECTED";
  if (team.paymentStatus === "PAID") return "PAID";
  return "COMPLETE";
}

export const TEAM_STATUS_LABEL: Record<TeamStatus, string> = {
  INCOMPLETE: "Incomplete",
  COMPLETE: "Complete, payment due",
  PAID: "Paid",
  PAYMENT_REJECTED: "Payment rejected",
  DISQUALIFIED: "Disqualified",
};

/** Why a team cannot enter a round, or null if it can. */
export function entryBlocker(opts: {
  round: Pick<Round, "restrictToQualified">;
  status: TeamStatus;
  qualified: boolean;
}): string | null {
  if (opts.status === "DISQUALIFIED") return "Your team has been disqualified.";
  if (opts.status === "INCOMPLETE") return "Your team needs more members before entering rounds.";
  if (opts.status !== "PAID") return "Upload your payment proof to unlock rounds.";
  if (opts.round.restrictToQualified && !opts.qualified) return "Only teams that qualified from the previous round can enter.";
  return null;
}

export function timeLeftMs(round: Pick<Round, "endsAt" | "durationMinutes">, startedAt: Date, now = new Date()) {
  const limits: number[] = [];
  if (round.durationMinutes) limits.push(startedAt.getTime() + round.durationMinutes * 60_000);
  if (round.endsAt) limits.push(round.endsAt.getTime());
  if (!limits.length) return null;
  return Math.max(0, Math.min(...limits) - now.getTime());
}
