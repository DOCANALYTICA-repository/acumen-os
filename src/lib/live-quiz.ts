import "server-only";
import type { LiveAnswer, LiveQuiz, Question } from "@prisma/client";
import { db, parseJson } from "./db";
import { quizMax, type QuizAnswer } from "./scoring";
import type { HostState, LivePhase, LiveQuestionView, PlayerState, StandingRow } from "./live-quiz-types";

const REVEALED: LivePhase[] = ["REVEAL", "LEADERBOARD", "FINISHED"];

/** Loads the round's live session, closing the current question first if its time is up or every team has answered. */
export async function loadLive(roundId: string) {
  const live = await db.liveQuiz.findUnique({ where: { roundId } });
  return live ? advanceIfDue(live) : null;
}

export async function advanceIfDue(live: LiveQuiz): Promise<LiveQuiz> {
  if (live.status !== "QUESTION" || !live.endsAt || !live.opensAt) return live;
  const now = Date.now();
  let due = now >= live.endsAt.getTime();
  if (!due && now >= live.opensAt.getTime()) {
    const qid = parseJson<string[]>(live.questionIds, [])[live.currentIndex];
    const [joined, answered] = await Promise.all([
      db.attempt.count({ where: { roundId: live.roundId } }),
      db.liveAnswer.count({ where: { liveId: live.id, questionId: qid } }),
    ]);
    due = joined > 0 && answered >= joined;
  }
  if (!due) return live;
  await db.liveQuiz.updateMany({
    where: { id: live.id, status: "QUESTION", currentIndex: live.currentIndex },
    data: { status: "REVEAL", endsAt: new Date(Math.min(now, live.endsAt.getTime())) },
  });
  return (await db.liveQuiz.findUnique({ where: { id: live.id } })) ?? live;
}

function view(q: Question): LiveQuestionView {
  return { id: q.id, type: q.type, text: q.text, options: parseJson<string[]>(q.options, []), timeLimit: q.timeLimit, marks: q.marks };
}

/** Questions that count towards the scoreboard right now (the open question is hidden until revealed). */
function countedQuestions(live: LiveQuiz, ids: string[]) {
  const n = REVEALED.includes(live.status as LivePhase) ? live.currentIndex + 1 : Math.max(0, live.currentIndex);
  return ids.slice(0, n);
}

export function standings(teams: { id: string; name: string }[], answers: LiveAnswer[], counted: string[]): StandingRow[] {
  const last = counted[counted.length - 1];
  const set = new Set(counted);
  const rows = teams.map((t) => {
    const mine = answers.filter((a) => a.teamId === t.id && set.has(a.questionId));
    const lastAns = mine.find((a) => a.questionId === last);
    return { teamId: t.id, name: t.name, points: mine.reduce((s, a) => s + a.points, 0), rank: 0, gained: lastAns?.points ?? 0, streak: lastAns?.streak ?? 0 };
  });
  rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  rows.forEach((r, i) => (r.rank = i > 0 && r.points === rows[i - 1].points ? rows[i - 1].rank : i + 1));
  return rows;
}

async function joinedTeams(roundId: string) {
  const attempts = await db.attempt.findMany({ where: { roundId }, include: { team: { select: { id: true, name: true } } }, orderBy: { startedAt: "asc" } });
  return attempts.map((a) => a.team);
}

function distribution(q: Question, answers: LiveAnswer[]): number[] {
  const opts = parseJson<string[]>(q.options, []);
  const given = answers.map((a) => parseJson<QuizAnswer>(a.answer, null));
  switch (q.type) {
    case "SINGLE":
      return opts.map((_, i) => given.filter((g) => g === i).length);
    case "MULTI":
      return opts.map((_, i) => given.filter((g) => Array.isArray(g) && g.includes(i)).length);
    case "TRUEFALSE":
      return [given.filter((g) => g === true).length, given.filter((g) => g === false).length];
    default:
      return [answers.filter((a) => a.correct).length, answers.filter((a) => !a.correct).length];
  }
}

export async function hostState(roundId: string): Promise<HostState> {
  const [live, questions, attemptCount] = await Promise.all([
    loadLive(roundId),
    db.question.findMany({ where: { roundId }, orderBy: { order: "asc" } }),
    db.attempt.count({ where: { roundId } }),
  ]);
  const base: HostState = {
    phase: "NONE", serverNow: Date.now(), opensAt: null, endsAt: null, index: -1, total: questions.length,
    question: null, nextQuestion: questions[0] ? { text: questions[0].text, type: questions[0].type } : null,
    teams: [], answered: 0, distribution: null, correctCount: 0, standings: [], maxMarks: quizMax(questions), hasResults: !live && attemptCount > 0,
  };
  if (!live) return base;
  const ids = parseJson<string[]>(live.questionIds, []);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const [teams, answers] = await Promise.all([joinedTeams(roundId), db.liveAnswer.findMany({ where: { liveId: live.id } })]);
  const q = byId.get(ids[live.currentIndex]);
  const next = byId.get(ids[live.currentIndex + 1]);
  const current = q ? answers.filter((a) => a.questionId === q.id) : [];
  const phase = live.status as LivePhase;
  return {
    ...base,
    phase,
    serverNow: Date.now(),
    opensAt: live.opensAt?.getTime() ?? null,
    endsAt: live.endsAt?.getTime() ?? null,
    index: live.currentIndex,
    total: ids.length,
    question: q ? { ...view(q), answer: parseJson<unknown>(q.answer, null) } : null,
    nextQuestion: next ? { text: next.text, type: next.type } : null,
    teams,
    answered: current.length,
    distribution: q && phase !== "QUESTION" ? distribution(q, current) : null,
    correctCount: current.filter((a) => a.correct).length,
    standings: standings(teams, answers, countedQuestions(live, ids)),
    maxMarks: quizMax(ids.map((id) => byId.get(id)).filter((x): x is Question => !!x)),
  };
}

/** Adds the team to the live game (an Attempt row). */
export async function joinLive(roundId: string, teamId: string) {
  await db.attempt.upsert({ where: { roundId_teamId: { roundId, teamId } }, create: { roundId, teamId }, update: {} });
}

export async function playerState(roundId: string, team: { id: string; name: string }): Promise<PlayerState> {
  const live = await loadLive(roundId);
  const base: PlayerState = {
    phase: "NONE", serverNow: Date.now(), opensAt: null, endsAt: null, index: -1, total: 0, teamName: team.name, teamCount: 0,
    question: null, mine: null, correctAnswer: null, me: { points: 0, rank: null, gained: 0, streak: 0 }, top: [],
  };
  if (!live) return base;
  if (live.status !== "FINISHED") await joinLive(roundId, team.id);
  const ids = parseJson<string[]>(live.questionIds, []);
  const [teams, answers] = await Promise.all([joinedTeams(roundId), db.liveAnswer.findMany({ where: { liveId: live.id } })]);
  const phase = live.status as LivePhase;
  const qid = ids[live.currentIndex];
  const q = qid ? await db.question.findUnique({ where: { id: qid } }) : null;
  const now = Date.now();
  const open = phase === "QUESTION" ? !!live.opensAt && now >= live.opensAt.getTime() : phase === "REVEAL" || phase === "LEADERBOARD";
  const revealed = REVEALED.includes(phase);
  const mineRow = q ? answers.find((a) => a.questionId === q.id && a.teamId === team.id) : undefined;
  const by = mineRow ? await db.user.findUnique({ where: { id: mineRow.userId }, select: { fullName: true } }) : null;
  const table = standings(teams, answers, countedQuestions(live, ids));
  const meRow = table.find((r) => r.teamId === team.id);
  return {
    ...base,
    phase,
    serverNow: Date.now(),
    opensAt: live.opensAt?.getTime() ?? null,
    endsAt: live.endsAt?.getTime() ?? null,
    index: live.currentIndex,
    total: ids.length,
    teamCount: teams.length,
    question: q && open ? view(q) : null,
    mine: mineRow
      ? { answer: parseJson<unknown>(mineRow.answer, null), answeredBy: by?.fullName ?? "A teammate", correct: revealed ? mineRow.correct : null, points: revealed ? mineRow.points : null, streak: revealed ? mineRow.streak : null }
      : null,
    correctAnswer: q && revealed ? parseJson<unknown>(q.answer, null) : null,
    me: meRow ? { points: meRow.points, rank: meRow.rank, gained: meRow.gained, streak: meRow.streak } : base.me,
    top: phase === "LEADERBOARD" || phase === "FINISHED" ? table.slice(0, 5) : [],
  };
}

/** Writes each joined team's marks (1000 points = 1 mark) into its Attempt so results, cut-offs and analytics pick them up. */
export async function writeLiveScores(live: LiveQuiz) {
  const ids = parseJson<string[]>(live.questionIds, []);
  const [questions, answers, attempts] = await Promise.all([
    db.question.findMany({ where: { id: { in: ids } } }),
    db.liveAnswer.findMany({ where: { liveId: live.id } }),
    db.attempt.findMany({ where: { roundId: live.roundId } }),
  ]);
  const max = quizMax(questions);
  const now = new Date();
  await db.$transaction(
    attempts.map((a) => {
      const mine = answers.filter((x) => x.teamId === a.teamId);
      const points = mine.reduce((s, x) => s + x.points, 0);
      const answerMap = Object.fromEntries(mine.map((x) => [x.questionId, parseJson<unknown>(x.answer, null)]));
      return db.attempt.update({
        where: { id: a.id },
        data: { submittedAt: now, autoScore: Math.min(max, Math.round(points / 10) / 100), answers: JSON.stringify(answerMap) },
      });
    }),
  );
}

/** Validates a raw answer against the question type; returns null if it is not a usable answer. */
export function normaliseAnswer(q: Pick<Question, "type" | "options">, raw: unknown): QuizAnswer | null {
  const n = parseJson<string[]>(q.options, []).length;
  switch (q.type) {
    case "SINGLE":
      return Number.isInteger(raw) && (raw as number) >= 0 && (raw as number) < n ? (raw as number) : null;
    case "MULTI": {
      if (!Array.isArray(raw)) return null;
      const picks = [...new Set(raw)].filter((x): x is number => Number.isInteger(x) && x >= 0 && x < n).sort((a, b) => a - b);
      return picks.length ? picks : null;
    }
    case "TRUEFALSE":
      return typeof raw === "boolean" ? raw : null;
    case "SHORT": {
      const s = typeof raw === "string" ? raw.trim().slice(0, 200) : "";
      return s ? s : null;
    }
    default:
      return null;
  }
}
