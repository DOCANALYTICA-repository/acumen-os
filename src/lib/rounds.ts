import type { Round, Team } from "@prisma/client";
import { parseJson } from "./db";

/**
 * QUIZ = host-led guesstimate; MANUAL = played off the platform, teams mark it done (optionally with a link) and organisers
 * enter marks; SUBMISSION = teams submit links that judges mark with a rubric; SIMULATION = the economy simulation.
 * Nothing is uploaded to the site: documents live on Google Classroom / Drive and are shared as links.
 */
export type RoundType = "QUIZ" | "SUBMISSION" | "SIMULATION" | "MANUAL";

export type ManualSettings = {
  maxMarks: number;
  /** Optional link shown to teams, e.g. the Google Classroom assignment. */
  link: string;
  linkLabel: string;
};

export const DEFAULT_MANUAL_SETTINGS: ManualSettings = { maxMarks: 100, link: "", linkLabel: "Open assignment" };

export function manualSettings(round: Pick<Round, "settings">): ManualSettings {
  return { ...DEFAULT_MANUAL_SETTINGS, ...parseJson<Partial<ManualSettings>>(round.settings, {}) };
}
export type EffectiveStatus = "DRAFT" | "UPCOMING" | "LIVE" | "CLOSED";

export type SubmissionSettings = {
  allowResubmit: boolean;
  allowLate: boolean;
  latePenaltyPct: number;
  anonymousJudging: boolean;
};

export const DEFAULT_SUBMISSION_SETTINGS: SubmissionSettings = {
  allowResubmit: true,
  allowLate: false,
  latePenaltyPct: 0,
  anonymousJudging: true,
};

/** Up to this many links per submission. */
export const MAX_SUBMISSION_LINKS = 5;

/** True for a plain https:// URL (no spaces). Every link teams or organisers paste must pass this. */
export function isHttpsUrl(v: string) {
  return /^https:\/\/[^\s]+$/.test(v);
}

export function submissionSettings(round: Pick<Round, "settings">): SubmissionSettings {
  return { ...DEFAULT_SUBMISSION_SETTINGS, ...parseJson<Partial<SubmissionSettings>>(round.settings, {}) };
}

export function effectiveStatus(round: Pick<Round, "status" | "startsAt" | "endsAt">, now = new Date()): EffectiveStatus {
  if (round.status === "DRAFT") return "DRAFT";
  if (round.status === "CLOSED") return "CLOSED";
  if (round.endsAt && now > round.endsAt) return "CLOSED";
  if (round.status === "LIVE") return "LIVE";
  if (round.startsAt && now < round.startsAt) return "UPCOMING";
  return round.startsAt ? "LIVE" : "UPCOMING";
}

export const TYPE_LABEL: Record<string, string> = {
  QUIZ: "Guesstimate",
  SUBMISSION: "Submission",
  SIMULATION: "Economy simulation",
  MANUAL: "Off-platform",
};

/** Acumen teams are exactly this many people. */
export const TEAM_SIZE = 2;

export type TeamStatus = "INCOMPLETE" | "COMPLETE" | "PAID" | "PAYMENT_REJECTED" | "DISQUALIFIED";

export function teamStatus(team: Pick<Team, "paymentStatus" | "disqualified">, memberCount: number): TeamStatus {
  if (team.disqualified) return "DISQUALIFIED";
  if (memberCount < TEAM_SIZE) return "INCOMPLETE";
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
  if (opts.status === "INCOMPLETE") return `Your team needs ${TEAM_SIZE} members before entering rounds.`;
  if (opts.status === "PAYMENT_REJECTED") return "Your payment receipt was rejected. Attach a new one on your dashboard to unlock rounds.";
  if (opts.status !== "PAID") return "Your team's payment hasn't been received yet. Contact the organisers.";
  if (opts.round.restrictToQualified && !opts.qualified) return "Only teams that qualified from the previous round can enter.";
  return null;
}
