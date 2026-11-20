import "server-only";
import type { LiveAnswer, LiveQuiz, Question } from "@prisma/client";
import { db, parseJson } from "./db";
import { quizMax } from "./scoring";
import type { HostQuestion, HostState, LivePhase, PlayerState, ReviewRow, StandingRow } from "./live-quiz-types";

/*
 * Host-led guesstimate round. The host moves a single "current question" pointer (forwards or back);
 * every team's screen shows that question with a number box. A team may save and re-save its answer
 * while the host is on that question. Ending the round locks every answer and writes marks.
 */

export async function loadLive(roundId: string) {
  return db.liveQuiz.findUnique({ where: { roundId } });
}

function numberAnswer(q: Question): number | null {
  const v = parseJson<unknown>(q.answer, null);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function hostQuestion(q: Question): HostQuestion {
  return { id: q.id, text: q.text, answer: numberAnswer(q), note: q.explanation };
}

async function joinedTeams(roundId: string) {
  const attempts = await db.attempt.findMany({ where: { roundId }, include: { team: { select: { id: true, name: true } } }, orderBy: { startedAt: "asc" } });
  return attempts.map((a) => a.team);
}

export function standings(teams: { id: string; name: string }[], answers: LiveAnswer[]): StandingRow[] {
  const rows = teams.map((t) => {
    const mine = answers.filter((a) => a.teamId === t.id);
    return { teamId: t.id, name: t.name, points: mine.reduce((s, a) => s + a.points, 0), rank: 0, answered: mine.length };
  });
  rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  rows.forEach((r, i) => (r.rank = i > 0 && r.points === rows[i - 1].points ? rows[i - 1].rank : i + 1));
  return rows;
}

/** Questions in play order: the order fixed when the lobby opened, or the round's current order. */
async function orderedQuestions(roundId: string, live: LiveQuiz | null) {
  const questions = await db.question.findMany({ where: { roundId }, orderBy: { order: "asc" } });
  if (!live) return questions;
  const byId = new Map(questions.map((q) => [q.id, q]));
  return parseJson<string[]>(live.questionIds, []).map((id) => byId.get(id)).filter((q): q is Question => !!q);
}

export async function hostState(roundId: string): Promise<HostState> {
  const live = await loadLive(roundId);
  const [questions, attemptCount] = await Promise.all([orderedQuestions(roundId, live), db.attempt.count({ where: { roundId } })]);
  const base: HostState = {
    phase: "NONE", serverNow: Date.now(), index: -1, total: questions.length, question: null,
    questions: questions.map(hostQuestion), teams: [], saved: 0, standings: [], maxMarks: quizMax(questions),
    hasResults: !live && attemptCount > 0,
  };
  if (!live) return base;
  const [teams, answers] = await Promise.all([joinedTeams(roundId), db.liveAnswer.findMany({ where: { liveId: live.id } })]);
  const q = questions[live.currentIndex];
  return {
    ...base,
    phase: live.status as LivePhase,
    index: live.currentIndex,
    question: q ? hostQuestion(q) : null,
    teams,
    saved: q ? answers.filter((a) => a.questionId === q.id).length : 0,
    standings: standings(teams, answers),
  };
}

/** Adds the team to the game (an Attempt row). */
export async function joinLive(roundId: string, teamId: string) {
  await db.attempt.upsert({ where: { roundId_teamId: { roundId, teamId } }, create: { roundId, teamId }, update: {} });
}

export async function playerState(roundId: string, team: { id: string; name: string }): Promise<PlayerState> {
  const [live, round] = await Promise.all([loadLive(roundId), db.round.findUnique({ where: { id: roundId }, select: { resultsPublished: true } })]);
  const published = !!round?.resultsPublished;
  const base: PlayerState = {
    phase: "NONE", serverNow: Date.now(), index: -1, total: 0, teamName: team.name, teamCount: 0,
    question: null, mine: null, answeredCount: 0, review: [], resultsPublished: published,
  };
  if (!live) return base;
  if (live.status !== "FINISHED") await joinLive(roundId, team.id);
  const [questions, teamCount, answers] = await Promise.all([
    orderedQuestions(roundId, live),
    db.attempt.count({ where: { roundId } }),
    db.liveAnswer.findMany({ where: { liveId: live.id, teamId: team.id } }),
  ]);
  const phase = live.status as LivePhase;
  const q = phase === "QUESTION" ? questions[live.currentIndex] : undefined;
  const mineRow = q ? answers.find((a) => a.questionId === q.id) : undefined;
  const by = mineRow ? await db.user.findUnique({ where: { id: mineRow.userId }, select: { fullName: true } }) : null;
  const review: ReviewRow[] =
    phase === "FINISHED"
      ? questions.map((qq, i) => {
          const a = answers.find((x) => x.questionId === qq.id);
          return {
            index: i,
            text: qq.text,
            value: a ? parseJson<number | null>(a.answer, null) : null,
            correct: published ? numberAnswer(qq) : null,
            points: published ? (a?.points ?? 0) : null,
          };
        })
      : [];
  return {
    ...base,
    phase,
    index: live.currentIndex,
    total: questions.length,
    teamCount,
    question: q ? { id: q.id, text: q.text } : null,
    mine: mineRow ? { value: parseJson<number>(mineRow.answer, 0), savedBy: by?.fullName ?? "A teammate", savedAt: mineRow.updatedAt.getTime() } : null,
    answeredCount: answers.length,
    review,
  };
}

/** Writes each joined team's points as marks into its Attempt, so results, cut-offs and analytics pick them up. */
export async function writeLiveScores(live: LiveQuiz) {
  const [answers, attempts] = await Promise.all([db.liveAnswer.findMany({ where: { liveId: live.id } }), db.attempt.findMany({ where: { roundId: live.roundId } })]);
  const now = new Date();
  await db.$transaction(
    attempts.map((a) => {
      const mine = answers.filter((x) => x.teamId === a.teamId);
      return db.attempt.update({
        where: { id: a.id },
        data: {
          submittedAt: now,
          autoScore: mine.reduce((s, x) => s + x.points, 0),
          answers: JSON.stringify(Object.fromEntries(mine.map((x) => [x.questionId, parseJson<unknown>(x.answer, null)]))),
        },
      });
    }),
  );
}
