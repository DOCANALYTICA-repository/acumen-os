"use server";

import { revalidatePath } from "next/cache";
import { db, audit } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { effectiveStatus, entryBlocker, isHttpsUrl, MAX_SUBMISSION_LINKS, submissionSettings, teamStatus } from "@/lib/rounds";
import type { FormState } from "./auth";

/** Loads the round + caller's team and checks the team may play it right now. */
async function roundContext(roundId: string) {
  const user = await requireRole("PARTICIPANT");
  const team = user.membership?.team;
  if (!team) throw new Error("Join a team first.");
  const round = await db.round.findUnique({ where: { id: roundId } });
  if (!round) throw new Error("Round not found.");
  const status = teamStatus(team, team.members.length);
  const qualified = !!(await db.qualification.findUnique({ where: { roundId_teamId: { roundId, teamId: team.id } } }));
  const blocker = entryBlocker({ round, status, qualified });
  return { user, team, round, blocker };
}

/**
 * Off-platform rounds: a team member marks the round done, optionally with a link to the work
 * (e.g. the Google Classroom submission), or undoes it before marks are entered.
 * Stored on the attempt as answers = {markedBy, link?}.
 */
export async function setRoundDone(_: FormState, fd: FormData): Promise<FormState> {
  const roundId = String(fd.get("roundId"));
  const done = fd.get("done") === "1";
  let ctx;
  try {
    ctx = await roundContext(roundId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const { user, team, round, blocker } = ctx;
  if (round.type !== "MANUAL") return { error: "Not an off-platform round." };
  if (blocker) return { error: blocker };
  const st = effectiveStatus(round);
  if (st === "DRAFT" || st === "UPCOMING") return { error: "This round is not open yet." };
  const existing = await db.attempt.findUnique({ where: { roundId_teamId: { roundId, teamId: team.id } } });
  if (existing?.manualScore != null) return { error: "Marks have been entered, so this can no longer be changed." };

  if (done) {
    const link = String(fd.get("link") ?? "").trim();
    if (link && (!isHttpsUrl(link) || link.length > 500)) return { error: "The link must start with https://" };
    const answers = JSON.stringify({ markedBy: user.fullName, ...(link ? { link } : {}) });
    await db.attempt.upsert({
      where: { roundId_teamId: { roundId, teamId: team.id } },
      create: { roundId, teamId: team.id, submittedAt: new Date(), answers },
      update: { submittedAt: new Date(), answers },
    });
  } else if (existing) {
    await db.attempt.update({ where: { id: existing.id }, data: { submittedAt: null, answers: "{}" } });
  }
  await audit(user.id, done ? "round.mark_done" : "round.unmark_done", `${round.name}:${team.name}`);
  revalidatePath(`/rounds/${roundId}`);
  revalidatePath("/dashboard");
  return { ok: done ? "Marked done." : "Undone." };
}

/** Judged rounds: teams submit https:// links (Drive, Classroom, YouTube…). Each submission is a new version. */
export async function submitLinks(_: FormState, fd: FormData): Promise<FormState> {
  const roundId = String(fd.get("roundId"));
  let ctx;
  try {
    ctx = await roundContext(roundId);
  } catch (e) {
    return { error: (e as Error).message };
  }
  const { user, team, round, blocker } = ctx;
  if (round.type !== "SUBMISSION") return { error: "Not a submission round." };
  if (blocker) return { error: blocker };
  const rules = submissionSettings(round);
  const st = effectiveStatus(round);
  const isLate = st === "CLOSED";
  if (st === "UPCOMING" || st === "DRAFT") return { error: "This round is not open yet." };
  if (isLate && !rules.allowLate) return { error: "The deadline has passed." };

  const previous = await db.submission.findFirst({ where: { roundId, teamId: team.id }, orderBy: { version: "desc" } });
  if (previous && !rules.allowResubmit) return { error: "This round accepts one submission only." };

  const links = String(fd.get("links") ?? "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!links.length) return { error: "Add at least one link." };
  if (links.length > MAX_SUBMISSION_LINKS) return { error: `You can add up to ${MAX_SUBMISSION_LINKS} links.` };
  if (links.some((l) => !isHttpsUrl(l) || l.length > 500)) return { error: "Each link must start with https://" };

  await db.submission.create({
    data: {
      roundId,
      teamId: team.id,
      uploadedById: user.id,
      links: JSON.stringify(links),
      title: String(fd.get("title") ?? "").trim().slice(0, 120),
      summary: String(fd.get("summary") ?? "").trim().slice(0, 3000),
      version: (previous?.version ?? 0) + 1,
      isLate,
    },
  });
  await audit(user.id, "round.submit", `${round.name}:${team.name}`);
  revalidatePath(`/rounds/${roundId}`);
  revalidatePath("/dashboard");
  return { ok: `Submitted${isLate ? " (late)" : ""}. Version ${(previous?.version ?? 0) + 1} saved at ${new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}.` };
}
