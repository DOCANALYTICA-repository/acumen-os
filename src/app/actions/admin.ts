"use server";

import { randomUUID } from "crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { db, audit } from "@/lib/db";
import { hashPassword, requireAdmin } from "@/lib/auth";
import { getContent, saveContent, type SiteContent } from "@/lib/content";
import { isHttpsUrl, manualSettings, TEAM_SIZE, type ManualSettings, type SubmissionSettings } from "@/lib/rounds";
import { computeLeaderboard, rankByRound } from "@/lib/scoring";
import { MAX_GUESS_POINTS, parseGuess } from "@/lib/live-quiz-types";
import { memberSchema } from "@/lib/registration";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const n = (fd: FormData, k: string, fallback = 0) => {
  const v = Number(fd.get(k));
  return Number.isFinite(v) ? v : fallback;
};
const date = (fd: FormData, k: string) => {
  const v = s(fd, k);
  // datetime-local inputs are entered in IST
  return v ? new Date(`${v}:00+05:30`) : null;
};

function refresh(...paths: string[]) {
  for (const p of ["/admin", ...paths]) revalidatePath(p);
  revalidatePath("/", "layout");
}

// ---------------- Rounds ----------------

export async function updateRound(fd: FormData) {
  const admin = await requireAdmin();
  const id = s(fd, "id");
  const round = await db.round.findUniqueOrThrow({ where: { id } });
  const data: Parameters<typeof db.round.update>[0]["data"] = {
    name: s(fd, "name") || round.name,
    description: s(fd, "description"),
    instructions: s(fd, "instructions"),
    startsAt: date(fd, "startsAt"),
    endsAt: date(fd, "endsAt"),
    briefUrl: s(fd, "briefUrl") || null,
    weight: n(fd, "weight", round.weight),
    status: s(fd, "status") || round.status,
    restrictToQualified: fd.get("restrictToQualified") === "on",
  };
  if (round.type === "SUBMISSION") {
    const settings: SubmissionSettings = {
      allowResubmit: fd.get("allowResubmit") === "on",
      allowLate: fd.get("allowLate") === "on",
      latePenaltyPct: Math.max(0, n(fd, "latePenaltyPct")),
      anonymousJudging: fd.get("anonymousJudging") === "on",
    };
    data.settings = JSON.stringify(settings);
  }
  if (round.type === "MANUAL") {
    const link = s(fd, "link");
    if (link && !isHttpsUrl(link)) throw new Error("The link must start with https://");
    const settings: ManualSettings = { maxMarks: Math.max(1, n(fd, "maxMarks", 100)), link, linkLabel: s(fd, "linkLabel") || "Open assignment" };
    data.settings = JSON.stringify(settings);
  }
  if (data.briefUrl && !isHttpsUrl(String(data.briefUrl))) throw new Error("The brief link must start with https://");
  if (data.startsAt && data.endsAt && data.endsAt <= data.startsAt) throw new Error("End time must be after start time.");
  await db.round.update({ where: { id }, data });
  await audit(admin.id, "round.update", round.name);
  refresh("/admin/rounds", `/admin/rounds/${id}`);
}

/** Guesstimate question: text plus one numeric correct answer (and an optional note shown with the answer). */
export async function addQuestion(fd: FormData) {
  await requireAdmin();
  const roundId = s(fd, "roundId");
  const text = s(fd, "text");
  const answer = parseGuess(s(fd, "answer"));
  if (!text) throw new Error("Question text is required.");
  if (answer === null) throw new Error("The correct answer must be a single number.");
  const count = await db.question.count({ where: { roundId } });
  await db.question.create({
    data: { roundId, type: "NUMBER", text, options: "[]", answer: JSON.stringify(answer), marks: MAX_GUESS_POINTS, explanation: s(fd, "explanation"), order: count },
  });
  refresh(`/admin/rounds/${roundId}`);
}

/** Moves a question up or down in play order. */
export async function moveQuestion(fd: FormData) {
  await requireAdmin();
  const q = await db.question.findUniqueOrThrow({ where: { id: s(fd, "id") } });
  const all = await db.question.findMany({ where: { roundId: q.roundId }, orderBy: { order: "asc" } });
  const i = all.findIndex((x) => x.id === q.id);
  const j = s(fd, "dir") === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  await db.$transaction(all.map((x, k) => db.question.update({ where: { id: x.id }, data: { order: k } })));
  refresh(`/admin/rounds/${q.roundId}`);
}

/** CSV columns: question,answer[,note]. Quote cells that contain commas. */
export async function importQuestions(fd: FormData) {
  await requireAdmin();
  const roundId = s(fd, "roundId");
  const file = fd.get("file");
  if (!(file instanceof File)) throw new Error("Choose a CSV file.");
  const lines = (await file.text()).split(/\r?\n/).filter((l) => l.trim());
  let order = await db.question.count({ where: { roundId } });
  const skipped: number[] = [];
  for (const [i, line] of lines.entries()) {
    if (i === 0 && /^"?question/i.test(line)) continue;
    const cols = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)?.map((c) => c.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"').trim()) ?? [];
    const [text, ans, note] = cols;
    const answer = parseGuess(ans ?? "");
    if (!text || answer === null) { skipped.push(i + 1); continue; }
    await db.question.create({
      data: { roundId, type: "NUMBER", text, options: "[]", answer: JSON.stringify(answer), marks: MAX_GUESS_POINTS, explanation: note ?? "", order: order++ },
    });
  }
  refresh(`/admin/rounds/${roundId}`);
  if (skipped.length) throw new Error(`Imported the rest; skipped line(s) ${skipped.join(", ")} (need question text and a numeric answer).`);
}

export async function deleteQuestion(fd: FormData) {
  await requireAdmin();
  const q = await db.question.delete({ where: { id: s(fd, "id") } });
  refresh(`/admin/rounds/${q.roundId}`);
}

export async function saveRubric(fd: FormData) {
  await requireAdmin();
  const roundId = s(fd, "roundId");
  const ids = fd.getAll("criterionId").map(String);
  const names = fd.getAll("criterionName").map(String);
  const maxes = fd.getAll("criterionMax").map(Number);
  const existing = await db.rubricCriterion.findMany({ where: { roundId } });
  const keep = new Set<string>();
  for (let i = 0; i < names.length; i++) {
    const name = names[i].trim();
    if (!name) continue;
    if (ids[i]) {
      keep.add(ids[i]);
      await db.rubricCriterion.update({ where: { id: ids[i] }, data: { name, maxMarks: maxes[i] || 0 } });
    } else await db.rubricCriterion.create({ data: { roundId, name, maxMarks: maxes[i] || 0 } });
  }
  for (const c of existing) if (!keep.has(c.id)) await db.rubricCriterion.delete({ where: { id: c.id } });
  refresh(`/admin/rounds/${roundId}`);
}

export async function setManualScore(fd: FormData) {
  await requireAdmin();
  const id = s(fd, "attemptId");
  const v = s(fd, "manualScore");
  const a = await db.attempt.update({ where: { id }, data: { manualScore: v === "" ? null : Number(v) } });
  refresh(`/admin/rounds/${a.roundId}`, "/admin/results");
}

/** Off-platform rounds: organisers enter a team's marks (whether or not the team marked the round done). */
export async function setOffPlatformScore(fd: FormData) {
  const admin = await requireAdmin();
  const roundId = s(fd, "roundId");
  const teamId = s(fd, "teamId");
  const round = await db.round.findUniqueOrThrow({ where: { id: roundId } });
  if (round.type !== "MANUAL") throw new Error("Not an off-platform round.");
  const raw = s(fd, "score");
  const max = manualSettings(round).maxMarks;
  const score = raw === "" ? null : Number(raw);
  if (score !== null && (Number.isNaN(score) || score < 0 || score > max)) throw new Error(`Marks must be between 0 and ${max}.`);
  await db.attempt.upsert({
    where: { roundId_teamId: { roundId, teamId } },
    create: { roundId, teamId, manualScore: score },
    update: { manualScore: score },
  });
  await audit(admin.id, "round.manual_score", `${round.name}:${teamId}:${raw || "cleared"}`);
  refresh(`/admin/rounds/${roundId}`, "/admin/results", "/dashboard");
}

// ---------------- Results & qualification ----------------

export async function setPublished(fd: FormData) {
  const admin = await requireAdmin();
  const id = s(fd, "roundId");
  const publish = s(fd, "publish") === "1";
  await db.round.update({ where: { id }, data: { resultsPublished: publish } });
  await audit(admin.id, publish ? "results.publish" : "results.unpublish", id);
  refresh("/admin/results", "/dashboard");
}

/** Qualifies the top N teams (by one round or overall) into a target round and restricts entry to them. */
export async function qualifyTopN(fd: FormData) {
  const admin = await requireAdmin();
  const target = s(fd, "targetRoundId");
  const basis = s(fd, "basis"); // "overall" or a roundId
  const count = Math.max(1, n(fd, "count", 10));
  const { rows } = await computeLeaderboard();
  const ranked = basis === "overall" ? rows : rankByRound(rows, basis);
  const winners = ranked.slice(0, count);
  await db.$transaction([
    db.qualification.deleteMany({ where: { roundId: target } }),
    ...winners.map((w) => db.qualification.create({ data: { roundId: target, teamId: w.teamId } })),
    db.round.update({ where: { id: target }, data: { restrictToQualified: true } }),
  ]);
  await audit(admin.id, "results.qualify", `${target}: top ${count} by ${basis}`);
  refresh("/admin/results", "/dashboard");
}

export async function clearQualification(fd: FormData) {
  await requireAdmin();
  const target = s(fd, "targetRoundId");
  await db.$transaction([
    db.qualification.deleteMany({ where: { roundId: target } }),
    db.round.update({ where: { id: target }, data: { restrictToQualified: false } }),
  ]);
  refresh("/admin/results");
}

export async function setOverride(fd: FormData) {
  const admin = await requireAdmin();
  const roundId = s(fd, "roundId");
  const teamId = s(fd, "teamId");
  const v = s(fd, "score");
  if (v === "") await db.resultOverride.deleteMany({ where: { roundId, teamId } });
  else {
    const score = Math.min(100, Math.max(0, Number(v)));
    await db.resultOverride.upsert({ where: { roundId_teamId: { roundId, teamId } }, create: { roundId, teamId, score }, update: { score } });
  }
  await audit(admin.id, "results.override", `${roundId}:${teamId}=${v || "cleared"}`);
  refresh("/admin/results", "/admin/submissions");
}

// ---------------- Teams ----------------

export async function setPaymentStatus(fd: FormData) {
  const admin = await requireAdmin();
  const team = await db.team.update({ where: { id: s(fd, "teamId") }, data: { paymentStatus: s(fd, "status") } });
  await audit(admin.id, "team.payment_status", `${team.name}=${team.paymentStatus}`);
  refresh("/admin/teams");
}

export async function toggleDisqualify(fd: FormData) {
  const admin = await requireAdmin();
  const t = await db.team.findUniqueOrThrow({ where: { id: s(fd, "teamId") } });
  await db.team.update({ where: { id: t.id }, data: { disqualified: !t.disqualified } });
  await audit(admin.id, t.disqualified ? "team.reinstate" : "team.disqualify", t.name);
  refresh("/admin/teams");
}

export async function saveTeamNote(fd: FormData) {
  await requireAdmin();
  await db.team.update({ where: { id: s(fd, "teamId") }, data: { notes: s(fd, "notes") || null } });
  refresh("/admin/teams");
}

/** Validated member fields from an admin form, or throws with a readable message. */
function memberFromForm(fd: FormData) {
  const parsed = memberSchema.safeParse({ fullName: s(fd, "fullName"), email: s(fd, "email"), phone: s(fd, "phone"), college: s(fd, "college"), year: s(fd, "year") });
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);
  return parsed.data;
}

async function assertEmailFree(email: string, exceptUserId?: string) {
  const other = await db.user.findUnique({ where: { email } });
  if (other && other.id !== exceptUserId) throw new Error(`${email} is already used by another account.`);
}

/** Edit a member in place (also how organisers replace a teammate). Captains can also be given a new password. */
export async function adminUpdateMember(fd: FormData) {
  const admin = await requireAdmin();
  const m = await db.teamMember.findUniqueOrThrow({ where: { id: s(fd, "memberId") }, include: { team: true } });
  const data = memberFromForm(fd);
  await assertEmailFree(data.email, m.userId);
  const password = s(fd, "newPassword");
  if (password && !m.isLead) throw new Error("Only the captain logs in, so only the captain can have a password.");
  if (password && password.length < 8) throw new Error("The new password must be at least 8 characters.");
  await db.user.update({ where: { id: m.userId }, data: { ...data, ...(password ? { passwordHash: await hashPassword(password) } : {}) } });
  await audit(admin.id, "team.admin_edit_member", `${m.team.name}:${data.email}${password ? " (password reset)" : ""}`);
  refresh("/admin/teams");
}

/** Add a teammate to a team that is short (e.g. after a removal). The new member can't log in; the captain does. */
export async function adminAddMember(fd: FormData) {
  const admin = await requireAdmin();
  const team = await db.team.findUniqueOrThrow({ where: { id: s(fd, "teamId") }, include: { members: true } });
  if (team.members.length >= TEAM_SIZE) throw new Error(`${team.name} already has ${TEAM_SIZE} members.`);
  const data = memberFromForm(fd);
  await assertEmailFree(data.email);
  const user = await db.user.create({ data: { ...data, passwordHash: await hashPassword(randomUUID() + randomUUID()) } });
  await db.teamMember.create({ data: { teamId: team.id, userId: user.id, isLead: team.members.length === 0 } });
  await audit(admin.id, "team.admin_add_member", `${team.name}:${data.email}`);
  refresh("/admin/teams");
}

/**
 * Removes a teammate and, when nothing else references it, their account too, so the email can register again.
 * The captain can't be removed (they are the team's login): edit their details instead.
 */
export async function adminRemoveMember(fd: FormData) {
  const admin = await requireAdmin();
  const m = await db.teamMember.findUniqueOrThrow({ where: { id: s(fd, "memberId") }, include: { team: true, user: true } });
  if (m.isLead) throw new Error("The captain is the team's login and can't be removed. Edit their details instead.");
  await db.teamMember.delete({ where: { id: m.id } });
  if (m.user.role === "PARTICIPANT") await db.user.delete({ where: { id: m.userId } }).catch(() => {});
  await audit(admin.id, "team.admin_remove_member", `${m.team.name}:${m.user.email}`);
  refresh("/admin/teams");
}

// ---------------- Judging ----------------

export async function assignJudge(fd: FormData) {
  await requireAdmin();
  const roundId = s(fd, "roundId"), teamId = s(fd, "teamId"), judgeId = s(fd, "judgeId");
  if (!judgeId) return;
  await db.judgeAssignment.upsert({
    where: { roundId_teamId_judgeId: { roundId, teamId, judgeId } },
    create: { roundId, teamId, judgeId },
    update: {},
  });
  refresh("/admin/submissions");
}

export async function unassignJudge(fd: FormData) {
  await requireAdmin();
  await db.judgeAssignment.delete({ where: { id: s(fd, "id") } });
  refresh("/admin/submissions");
}

/** Round-robin: gives every submitted team `perTeam` judges, balancing load. */
export async function autoAssign(fd: FormData) {
  const admin = await requireAdmin();
  const roundId = s(fd, "roundId");
  const perTeam = Math.max(1, n(fd, "perTeam", 2));
  const judges = await db.user.findMany({ where: { role: "JUDGE" }, orderBy: { createdAt: "asc" } });
  if (!judges.length) throw new Error("Create judge accounts first (Content & settings → Staff).");
  const teams = [...new Set((await db.submission.findMany({ where: { roundId }, select: { teamId: true } })).map((x) => x.teamId))];
  const existing = await db.judgeAssignment.findMany({ where: { roundId } });
  const load = new Map(judges.map((j) => [j.id, existing.filter((e) => e.judgeId === j.id).length]));
  for (const teamId of teams) {
    const have = existing.filter((e) => e.teamId === teamId).map((e) => e.judgeId);
    const need = Math.min(perTeam, judges.length) - have.length;
    const pick = judges.filter((j) => !have.includes(j.id)).sort((a, b) => load.get(a.id)! - load.get(b.id)!).slice(0, Math.max(0, need));
    for (const j of pick) {
      await db.judgeAssignment.create({ data: { roundId, teamId, judgeId: j.id } });
      load.set(j.id, load.get(j.id)! + 1);
    }
  }
  await audit(admin.id, "judging.auto_assign", `${roundId}: ${perTeam} per team`);
  refresh("/admin/submissions");
}

// ---------------- Content, announcements, assets, staff ----------------

export async function saveSiteContent(fd: FormData) {
  const admin = await requireAdmin();
  const current = await getContent();
  const faq = s(fd, "faq").split(/\n\s*\n/).map((block) => {
    const [q, ...rest] = block.split("\n");
    return { q: q.replace(/^Q:\s*/i, "").trim(), a: rest.join(" ").replace(/^A:\s*/i, "").trim() };
  }).filter((f) => f.q && f.a);
  const sponsors = s(fd, "sponsors").split("\n").map((l) => {
    const [name, url] = l.split("|").map((x) => x.trim());
    return { name, url: url ?? "" };
  }).filter((x) => x.name);
  const deadline = s(fd, "registrationDeadline");
  for (const [label, url] of [["Payment portal link", s(fd, "paymentLink")], ["WhatsApp group link", s(fd, "community")]])
    if (url && !isHttpsUrl(url)) throw new Error(`${label} must start with https://`);
  const next: SiteContent = {
    ...current,
    eventName: s(fd, "eventName") || current.eventName,
    tagline: s(fd, "tagline"),
    eventDates: s(fd, "eventDates"),
    registrationDeadline: deadline ? new Date(`${deadline}:00+05:30`).toISOString() : "",
    heroBlurb: s(fd, "heroBlurb"),
    about: s(fd, "about"),
    prizes: s(fd, "prizes"),
    fee: s(fd, "fee"),
    paymentInstructions: s(fd, "paymentInstructions"),
    paymentLink: s(fd, "paymentLink"),
    paymentSteps: s(fd, "paymentSteps").split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
    contactEmail: s(fd, "contactEmail"),
    contactPhone: s(fd, "contactPhone"),
    instagram: s(fd, "instagram"),
    community: s(fd, "community"),
    faq,
    sponsors,
  };
  await saveContent(next);
  await audit(admin.id, "content.update");
  refresh("/admin/content");
}

export async function addAnnouncement(fd: FormData) {
  await requireAdmin();
  const message = s(fd, "message");
  if (!message) return;
  await db.announcement.updateMany({ data: { active: false } });
  await db.announcement.create({ data: { message } });
  revalidateTag("announcement");
  refresh("/admin/content");
}

export async function toggleAnnouncement(fd: FormData) {
  await requireAdmin();
  const a = await db.announcement.findUniqueOrThrow({ where: { id: s(fd, "id") } });
  if (!a.active) await db.announcement.updateMany({ data: { active: false } });
  await db.announcement.update({ where: { id: a.id }, data: { active: !a.active } });
  revalidateTag("announcement");
  refresh("/admin/content");
}

/** Resources are links (Google Drive, Docs…). PARTICIPANTS ones are listed only to signed-in users. */
export async function addAsset(fd: FormData) {
  await requireAdmin();
  const url = s(fd, "url");
  if (!isHttpsUrl(url)) throw new Error("The link must start with https://");
  await db.asset.create({
    data: { title: s(fd, "title") || url, category: s(fd, "category") || "General", url, visibility: s(fd, "visibility") === "PARTICIPANTS" ? "PARTICIPANTS" : "PUBLIC" },
  });
  refresh("/admin/content");
}

export async function deleteAsset(fd: FormData) {
  await requireAdmin();
  await db.asset.delete({ where: { id: s(fd, "id") } });
  refresh("/admin/content");
}
