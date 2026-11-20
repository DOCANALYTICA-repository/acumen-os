"use server";

import { revalidatePath } from "next/cache";
import { unlink } from "fs/promises";
import { db, audit } from "@/lib/db";
import { hashPassword, requireAdmin } from "@/lib/auth";
import { getContent, saveContent, type SiteContent } from "@/lib/content";
import { ALL_FILE_TYPES, manualSettings, type ExcelKeyItem, type ManualSettings, type SubmissionSettings } from "@/lib/rounds";
import { computeLeaderboard, rankByRound } from "@/lib/scoring";
import { MAX_GUESS_POINTS, parseGuess } from "@/lib/live-quiz-types";
import { resolveStoragePath, saveUpload } from "@/lib/files";

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
    durationMinutes: s(fd, "durationMinutes") ? n(fd, "durationMinutes") : null,
    weight: n(fd, "weight", round.weight),
    status: s(fd, "status") || round.status,
    restrictToQualified: fd.get("restrictToQualified") === "on",
  };
  if (round.type === "SUBMISSION") {
    const settings: SubmissionSettings = {
      allowedTypes: fd.getAll("allowedTypes").map(String).filter((t) => ALL_FILE_TYPES.includes(t)),
      maxSizeMB: Math.min(500, Math.max(1, n(fd, "maxSizeMB", 25))),
      maxFiles: Math.min(10, Math.max(1, n(fd, "maxFiles", 1))),
      allowResubmit: fd.get("allowResubmit") === "on",
      allowLate: fd.get("allowLate") === "on",
      latePenaltyPct: Math.max(0, n(fd, "latePenaltyPct")),
      allowLinks: fd.get("allowLinks") === "on",
      anonymousJudging: fd.get("anonymousJudging") === "on",
    };
    if (!settings.allowedTypes.length) settings.allowedTypes = ["pdf"];
    data.settings = JSON.stringify(settings);
  }
  if (round.type === "MANUAL") {
    const link = s(fd, "link");
    if (link && !/^https:\/\/\S+$/.test(link)) throw new Error("The link must start with https://");
    const settings: ManualSettings = { maxMarks: Math.max(1, n(fd, "maxMarks", 100)), link, linkLabel: s(fd, "linkLabel") || "Open assignment" };
    data.settings = JSON.stringify(settings);
  }
  if (data.startsAt && data.endsAt && data.endsAt <= data.startsAt) throw new Error("End time must be after start time.");
  await db.round.update({ where: { id }, data });
  await audit(admin.id, "round.update", round.name);
  refresh("/admin/rounds", `/admin/rounds/${id}`);
}

export async function uploadRoundFile(fd: FormData) {
  const admin = await requireAdmin();
  const id = s(fd, "id");
  const kind = s(fd, "kind"); // brief | template
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file.");
  if (kind === "template" && !file.name.toLowerCase().endsWith(".xlsx")) throw new Error("The Excel template must be an .xlsx file.");
  const saved = await saveUpload(file, `rounds/${id}`);
  await db.round.update({ where: { id }, data: kind === "template" ? { excelTemplate: saved.path } : { briefFile: saved.path } });
  await audit(admin.id, `round.upload_${kind}`, id);
  refresh(`/admin/rounds/${id}`);
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

export async function saveExcelKey(fd: FormData) {
  const admin = await requireAdmin();
  const roundId = s(fd, "roundId");
  const cells = fd.getAll("cell").map(String);
  const key: ExcelKeyItem[] = cells
    .map((cell, i) => ({
      cell: cell.trim(),
      label: String(fd.getAll("label")[i] ?? "").trim(),
      value: String(fd.getAll("value")[i] ?? "").trim(),
      tolerance: Number(fd.getAll("tolerance")[i]) || 0,
      marks: Number(fd.getAll("marks")[i]) || 0,
    }))
    .filter((k) => k.cell && k.value);
  await db.round.update({ where: { id: roundId }, data: { excelAnswerKey: JSON.stringify(key) } });
  await audit(admin.id, "round.excel_key", `${roundId}:${key.length} cells`);
  refresh(`/admin/rounds/${roundId}`);
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

export async function adminRemoveMember(fd: FormData) {
  const admin = await requireAdmin();
  const m = await db.teamMember.findUniqueOrThrow({ where: { id: s(fd, "memberId") }, include: { team: { include: { members: true } } } });
  await db.teamMember.delete({ where: { id: m.id } });
  if (m.isLead) {
    const next = m.team.members.find((x) => x.id !== m.id);
    if (next) await db.teamMember.update({ where: { id: next.id }, data: { isLead: true } });
    else await db.team.delete({ where: { id: m.teamId } });
  }
  await audit(admin.id, "team.admin_remove_member", `${m.team.name}:${m.userId}`);
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
  const next: SiteContent = {
    ...current,
    eventName: s(fd, "eventName") || current.eventName,
    tagline: s(fd, "tagline"),
    eventDates: s(fd, "eventDates"),
    registrationDeadline: deadline ? new Date(`${deadline}:00+05:30`).toISOString() : "",
    heroBlurb: s(fd, "heroBlurb"),
    about: s(fd, "about"),
    prizes: s(fd, "prizes"),
    teamMin: Math.max(1, n(fd, "teamMin", current.teamMin)),
    teamMax: Math.max(1, n(fd, "teamMax", current.teamMax)),
    fee: s(fd, "fee"),
    paymentInstructions: s(fd, "paymentInstructions"),
    contactEmail: s(fd, "contactEmail"),
    contactPhone: s(fd, "contactPhone"),
    instagram: s(fd, "instagram"),
    community: s(fd, "community"),
    faq,
    sponsors,
  };
  if (next.teamMin > next.teamMax) throw new Error("Minimum team size cannot exceed maximum.");
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
  refresh("/admin/content");
}

export async function toggleAnnouncement(fd: FormData) {
  await requireAdmin();
  const a = await db.announcement.findUniqueOrThrow({ where: { id: s(fd, "id") } });
  if (!a.active) await db.announcement.updateMany({ data: { active: false } });
  await db.announcement.update({ where: { id: a.id }, data: { active: !a.active } });
  refresh("/admin/content");
}

export async function uploadAsset(fd: FormData) {
  await requireAdmin();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file.");
  const saved = await saveUpload(file, "assets");
  await db.asset.create({
    data: { title: s(fd, "title") || file.name, category: s(fd, "category") || "General", filePath: saved.path, visibility: s(fd, "visibility") === "PARTICIPANTS" ? "PARTICIPANTS" : "PUBLIC" },
  });
  refresh("/admin/content");
}

export async function deleteAsset(fd: FormData) {
  await requireAdmin();
  const a = await db.asset.delete({ where: { id: s(fd, "id") } });
  await unlink(resolveStoragePath(a.filePath)).catch(() => {});
  refresh("/admin/content");
}

export async function createStaff(fd: FormData) {
  const admin = await requireAdmin();
  const email = s(fd, "email").toLowerCase();
  const password = s(fd, "password");
  const role = s(fd, "role") === "ADMIN" ? "ADMIN" : "JUDGE";
  if (!email.includes("@") || password.length < 8) throw new Error("Enter a valid email and a password of at least 8 characters.");
  if (await db.user.findUnique({ where: { email } })) throw new Error("A user with this email already exists.");
  await db.user.create({ data: { fullName: s(fd, "fullName") || email, email, passwordHash: await hashPassword(password), role, college: "Staff" } });
  await audit(admin.id, "staff.create", `${email} (${role})`);
  refresh("/admin/content");
}

export async function deleteStaff(fd: FormData) {
  const admin = await requireAdmin();
  const id = s(fd, "id");
  if (id === admin.id) throw new Error("You cannot remove your own account.");
  const u = await db.user.findUniqueOrThrow({ where: { id } });
  if (u.role === "PARTICIPANT") throw new Error("Not a staff account.");
  await db.user.delete({ where: { id } });
  await audit(admin.id, "staff.delete", u.email);
  refresh("/admin/content");
}
