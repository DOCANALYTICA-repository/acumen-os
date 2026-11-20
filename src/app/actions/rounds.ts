"use server";

import { revalidatePath } from "next/cache";
import { readFile } from "fs/promises";
import { db, audit, parseJson } from "@/lib/db";
import { requireRole } from "@/lib/auth";
import { effectiveStatus, entryBlocker, excelKey, submissionSettings, teamStatus, timeLeftMs } from "@/lib/rounds";
import { readWorkbookCells, scoreExcel } from "@/lib/scoring";
import { extOf, resolveStoragePath, saveUpload, type StoredFile } from "@/lib/files";
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
  return { user, team, round, blocker, live: effectiveStatus(round) === "LIVE" };
}

/** Scores and closes an Excel attempt. (Quiz rounds are scored by the live quiz host flow.) */
async function finalizeAttempt(attemptId: string) {
  const attempt = await db.attempt.findUnique({ where: { id: attemptId }, include: { round: true } });
  if (!attempt || attempt.submittedAt || attempt.round.type !== "EXCEL") return;
  const key = excelKey(attempt.round);
  let values = parseJson<Record<string, string>>(attempt.answers, {});
  if (attempt.fileUrl) {
    try {
      const fromBook = readWorkbookCells(await readFile(resolveStoragePath(attempt.fileUrl)), key.map((k) => k.cell));
      values = Object.fromEntries(key.map((k) => [k.cell, String(values[k.cell] ?? "").trim() || fromBook[k.cell]]));
    } catch {
      /* unreadable workbook: score typed answers only */
    }
  }
  await db.attempt.update({ where: { id: attempt.id }, data: { submittedAt: new Date(), autoScore: scoreExcel(key, values) } });
}

/** Called on page load: closes Excel attempts whose timer ran out. */
export async function finalizeIfExpired(roundId: string, teamId: string) {
  const attempt = await db.attempt.findUnique({ where: { roundId_teamId: { roundId, teamId } }, include: { round: true } });
  if (!attempt || attempt.submittedAt || attempt.round.type !== "EXCEL") return;
  const left = timeLeftMs(attempt.round, attempt.startedAt);
  if (left !== null && left <= 0) await finalizeAttempt(attempt.id);
}

export async function startAttempt(fd: FormData) {
  const roundId = String(fd.get("roundId"));
  const { user, team, round, blocker, live } = await roundContext(roundId);
  if (blocker || !live || round.type !== "EXCEL") return;
  await db.attempt.upsert({
    where: { roundId_teamId: { roundId, teamId: team.id } },
    create: { roundId, teamId: team.id },
    update: {},
  });
  await audit(user.id, "round.start", `${round.name}:${team.name}`);
  revalidatePath(`/rounds/${roundId}`);
}

async function openAttempt(roundId: string) {
  const { team, round } = await roundContext(roundId);
  if (round.type !== "EXCEL") throw new Error("Not an Excel round.");
  const attempt = await db.attempt.findUnique({ where: { roundId_teamId: { roundId, teamId: team.id } } });
  if (!attempt || attempt.submittedAt) throw new Error("This attempt is already submitted.");
  const left = timeLeftMs(round, attempt.startedAt);
  if (left !== null && left <= 0) {
    await finalizeAttempt(attempt.id);
    throw new Error("Time is up. Your answers were submitted.");
  }
  return attempt;
}

export async function saveAnswer(roundId: string, key: string, value: unknown) {
  try {
    const attempt = await openAttempt(roundId);
    const answers = parseJson<Record<string, unknown>>(attempt.answers, {});
    answers[key] = value;
    await db.attempt.update({ where: { id: attempt.id }, data: { answers: JSON.stringify(answers) } });
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
}

export async function logTabSwitch(roundId: string) {
  try {
    const attempt = await openAttempt(roundId);
    await db.attempt.update({ where: { id: attempt.id }, data: { tabSwitches: { increment: 1 } } });
  } catch {
    /* ignore */
  }
}

export async function submitAttempt(roundId: string) {
  const { team } = await roundContext(roundId);
  const attempt = await db.attempt.findUnique({ where: { roundId_teamId: { roundId, teamId: team.id } } });
  if (attempt) await finalizeAttempt(attempt.id);
  revalidatePath(`/rounds/${roundId}`);
  revalidatePath("/dashboard");
}

/** Off-platform rounds: a team member marks the round done (or undoes it before marks are entered). */
export async function setRoundDone(fd: FormData) {
  const roundId = String(fd.get("roundId"));
  const done = fd.get("done") === "1";
  const { user, team, round, blocker } = await roundContext(roundId);
  if (round.type !== "MANUAL" || blocker) return;
  const st = effectiveStatus(round);
  if (st === "DRAFT" || st === "UPCOMING") return;
  const existing = await db.attempt.findUnique({ where: { roundId_teamId: { roundId, teamId: team.id } } });
  if (existing?.manualScore != null) return; // marks entered: locked
  if (done) {
    await db.attempt.upsert({
      where: { roundId_teamId: { roundId, teamId: team.id } },
      create: { roundId, teamId: team.id, submittedAt: new Date(), answers: JSON.stringify({ markedBy: user.fullName }) },
      update: { submittedAt: new Date(), answers: JSON.stringify({ markedBy: user.fullName }) },
    });
  } else if (existing) {
    await db.attempt.update({ where: { id: existing.id }, data: { submittedAt: null, answers: "{}" } });
  }
  await audit(user.id, done ? "round.mark_done" : "round.unmark_done", `${round.name}:${team.name}`);
  revalidatePath(`/rounds/${roundId}`);
  revalidatePath("/dashboard");
}

export async function uploadWorkbook(_: FormState, fd: FormData): Promise<FormState> {
  const roundId = String(fd.get("roundId"));
  try {
    const attempt = await openAttempt(roundId);
    const file = fd.get("workbook");
    if (!(file instanceof File) || file.size === 0) return { error: "Choose your .xlsx file." };
    if (extOf(file.name) !== "xlsx") return { error: "Upload an .xlsx file." };
    if (file.size > 10 * 1024 * 1024) return { error: "Workbook must be 10 MB or smaller." };
    const saved = await saveUpload(file, `teams/${attempt.teamId}/excel`);
    await db.attempt.update({ where: { id: attempt.id }, data: { fileUrl: saved.path } });
    revalidatePath(`/rounds/${roundId}`);
    return { ok: "Workbook uploaded. Empty answer boxes will be filled from its Answers sheet when you submit." };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function submitFiles(_: FormState, fd: FormData): Promise<FormState> {
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

  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const links = String(fd.get("links") ?? "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!files.length && !(rules.allowLinks && links.length)) return { error: "Attach at least one file." };
  if (files.length > rules.maxFiles) return { error: `You can upload up to ${rules.maxFiles} file(s).` };
  for (const f of files) {
    if (!rules.allowedTypes.includes(extOf(f.name))) return { error: `${f.name}: allowed types are ${rules.allowedTypes.join(", ")}.` };
    if (f.size > rules.maxSizeMB * 1024 * 1024) return { error: `${f.name} is larger than ${rules.maxSizeMB} MB.` };
  }
  if (links.some((l) => !/^https:\/\/\S+$/.test(l))) return { error: "Links must start with https://" };

  const saved: StoredFile[] = [];
  for (const f of files) saved.push(await saveUpload(f, `teams/${team.id}/round-${round.order}`));

  await db.submission.create({
    data: {
      roundId,
      teamId: team.id,
      uploadedById: user.id,
      files: JSON.stringify(saved),
      links: JSON.stringify(rules.allowLinks ? links : []),
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
