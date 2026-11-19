import "server-only";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { db, audit, parseJson } from "./db";
import { isQuizAnswerCorrect } from "./scoring";
import { advanceIfDue, joinLive, loadLive, normaliseAnswer, writeLiveScores } from "./live-quiz";
import { READY_SECONDS, speedPoints, type LiveResult } from "./live-quiz-types";

/*
 * Live quiz commands. These run from the POST /api/live/[roundId] route rather than as server actions:
 * a plain fetch per click cannot get stuck behind other router work, which matters when a room of
 * teams is tapping at once. Every host command names the question it expects, so a double click or a
 * stale screen is a harmless no-op.
 */

function refresh(roundId: string) {
  revalidatePath(`/admin/rounds/${roundId}`);
  revalidatePath("/admin/results");
  revalidatePath("/dashboard");
}

export type HostCommand = "open" | "next" | "reveal" | "leaderboard" | "finish" | "reset";

export async function runHostCommand(roundId: string, cmd: HostCommand, expectedIndex: number, adminId: string): Promise<LiveResult> {
  try {
    switch (cmd) {
      case "open":
        await open(roundId, adminId);
        break;
      case "next":
        await next(roundId, expectedIndex);
        break;
      case "reveal":
        await db.liveQuiz.updateMany({ where: { roundId, status: "QUESTION", currentIndex: expectedIndex }, data: { status: "REVEAL", endsAt: new Date() } });
        break;
      case "leaderboard":
        await db.liveQuiz.updateMany({ where: { roundId, status: "REVEAL", currentIndex: expectedIndex }, data: { status: "LEADERBOARD" } });
        break;
      case "finish": {
        const live = await db.liveQuiz.findUnique({ where: { roundId } });
        if (!live) throw new Error("No game is open.");
        await finish(live.id);
        await audit(adminId, "quiz.finish", roundId);
        break;
      }
      case "reset":
        await db.$transaction([db.liveQuiz.deleteMany({ where: { roundId } }), db.attempt.deleteMany({ where: { roundId } })]);
        await audit(adminId, "quiz.reset", roundId);
        refresh(roundId);
        break;
      default:
        throw new Error("Unknown command.");
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Opens the lobby: fixes the question order and lets teams join. */
async function open(roundId: string, adminId: string) {
  const round = await db.round.findUnique({ where: { id: roundId }, include: { questions: { orderBy: { order: "asc" } }, liveQuiz: true } });
  if (!round || round.type !== "QUIZ") throw new Error("Not a quiz round.");
  if (round.liveQuiz) throw new Error("A game is already open for this round.");
  if (!round.questions.length) throw new Error("Add questions first.");
  if (await db.attempt.count({ where: { roundId } })) throw new Error("This round already has results. Reset the game first.");
  await db.liveQuiz.create({ data: { roundId, questionIds: JSON.stringify(round.questions.map((q) => q.id)) } });
  // Teams can only open a round that is not a draft; keep it visible while the game runs.
  const endsPassed = round.endsAt && round.endsAt.getTime() < Date.now();
  await db.round.update({ where: { id: roundId }, data: { status: "LIVE", ...(endsPassed ? { endsAt: null } : {}) } });
  await audit(adminId, "quiz.open", round.name);
  refresh(roundId);
}

/** From the lobby, a reveal or the leaderboard to the next question, or ends the game after the last one. */
async function next(roundId: string, expectedIndex: number) {
  const live = await loadLive(roundId);
  if (!live) throw new Error("No game is open.");
  if (live.currentIndex !== expectedIndex || !["LOBBY", "REVEAL", "LEADERBOARD"].includes(live.status)) return;
  const ids = parseJson<string[]>(live.questionIds, []);
  const nextIndex = live.currentIndex + 1;
  if (nextIndex >= ids.length) return finish(live.id);
  const q = await db.question.findUnique({ where: { id: ids[nextIndex] } });
  if (!q) throw new Error("That question was deleted. Reset the game.");
  const opensAt = new Date(Date.now() + READY_SECONDS * 1000);
  await db.liveQuiz.updateMany({
    where: { id: live.id, currentIndex: expectedIndex, status: live.status },
    data: { status: "QUESTION", currentIndex: nextIndex, opensAt, endsAt: new Date(opensAt.getTime() + q.timeLimit * 1000) },
  });
}

async function finish(liveId: string) {
  const claimed = await db.liveQuiz.updateMany({ where: { id: liveId, status: { not: "FINISHED" } }, data: { status: "FINISHED" } });
  if (!claimed.count) return;
  const live = await db.liveQuiz.findUniqueOrThrow({ where: { id: liveId } });
  await writeLiveScores(live);
  refresh(live.roundId);
}

/** A team locks in its answer to the open question. The first teammate to answer counts. Caller has checked the team may play. */
export async function submitLiveAnswer(roundId: string, index: number, raw: unknown, team: { id: string }, userId: string): Promise<LiveResult> {
  const live = await loadLive(roundId);
  if (!live || live.status !== "QUESTION" || live.currentIndex !== index || !live.opensAt || !live.endsAt) return { ok: false, error: "Time's up for this question." };
  const now = Date.now();
  if (now < live.opensAt.getTime()) return { ok: false, error: "Not open yet." };
  if (now > live.endsAt.getTime() + 750) return { ok: false, error: "Time's up for this question." };

  const ids = parseJson<string[]>(live.questionIds, []);
  const q = await db.question.findUnique({ where: { id: ids[index] } });
  if (!q) return { ok: false, error: "Question not found." };
  const answer = normaliseAnswer(q, raw);
  if (answer === null) return { ok: false, error: "Pick an answer first." };

  await joinLive(roundId, team.id);
  const correct = isQuizAnswerCorrect(q, answer);
  const ms = Math.max(0, now - live.opensAt.getTime());
  const prev = index > 0 ? await db.liveAnswer.findUnique({ where: { liveId_questionId_teamId: { liveId: live.id, questionId: ids[index - 1], teamId: team.id } } }) : null;
  try {
    await db.liveAnswer.create({
      data: {
        liveId: live.id, questionId: q.id, teamId: team.id, userId, answer: JSON.stringify(answer), correct,
        points: correct ? speedPoints(q.marks, ms, q.timeLimit) : 0, streak: correct ? (prev?.correct ? prev.streak : 0) + 1 : 0, ms,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { ok: false, error: "Your team already answered." };
    throw e;
  }
  await advanceIfDue(live); // closes the question once every team is in
  return { ok: true };
}
