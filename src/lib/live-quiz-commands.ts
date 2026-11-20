import "server-only";
import { revalidatePath } from "next/cache";
import { db, audit, parseJson } from "./db";
import { joinLive, loadLive, writeLiveScores } from "./live-quiz";
import { guessPoints, parseGuess, type LiveResult } from "./live-quiz-types";

/*
 * Guesstimate round commands, run from POST /api/live/[roundId] (plain fetch, not server actions, so a
 * click can never stall behind other router work while a room of teams is saving answers).
 */

function refresh(roundId: string) {
  revalidatePath(`/admin/rounds/${roundId}`);
  revalidatePath("/admin/results");
  revalidatePath("/dashboard");
}

export type HostCommand = "open" | "goto" | "finish" | "reopen" | "reset";

export async function runHostCommand(roundId: string, cmd: HostCommand, index: number, adminId: string): Promise<LiveResult> {
  try {
    switch (cmd) {
      case "open":
        await open(roundId, adminId);
        break;
      case "goto": {
        const live = await loadLive(roundId);
        if (!live || live.status === "FINISHED") throw new Error("No game is running.");
        const total = parseJson<string[]>(live.questionIds, []).length;
        if (index < 0 || index >= total) throw new Error("No such question.");
        await db.liveQuiz.update({ where: { id: live.id }, data: { status: "QUESTION", currentIndex: index } });
        break;
      }
      case "finish": {
        const live = await loadLive(roundId);
        if (!live) throw new Error("No game is open.");
        const claimed = await db.liveQuiz.updateMany({ where: { id: live.id, status: { not: "FINISHED" } }, data: { status: "FINISHED" } });
        if (claimed.count) {
          await writeLiveScores(live);
          await audit(adminId, "quiz.finish", roundId);
          refresh(roundId);
        }
        break;
      }
      case "reopen": {
        // Undo an accidental "End round": answers become editable again on the last question shown.
        const live = await loadLive(roundId);
        if (!live || live.status !== "FINISHED") throw new Error("The round is not ended.");
        await db.$transaction([
          db.liveQuiz.update({ where: { id: live.id }, data: { status: live.currentIndex >= 0 ? "QUESTION" : "LOBBY" } }),
          db.attempt.updateMany({ where: { roundId }, data: { submittedAt: null, autoScore: null } }),
        ]);
        await audit(adminId, "quiz.reopen", roundId);
        refresh(roundId);
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
  if (!round || round.type !== "QUIZ") throw new Error("Not a guesstimate round.");
  if (round.liveQuiz) throw new Error("A game is already open for this round.");
  if (!round.questions.length) throw new Error("Add questions first.");
  if (round.questions.some((q) => typeof parseJson<unknown>(q.answer, null) !== "number")) throw new Error("Every question needs a numeric correct answer.");
  if (await db.attempt.count({ where: { roundId } })) throw new Error("This round already has results. Reset the game first.");
  await db.liveQuiz.create({ data: { roundId, questionIds: JSON.stringify(round.questions.map((q) => q.id)) } });
  // Teams can only open a round that is not a draft; keep it visible while the game runs.
  const endsPassed = round.endsAt && round.endsAt.getTime() < Date.now();
  await db.round.update({ where: { id: roundId }, data: { status: "LIVE", ...(endsPassed ? { endsAt: null } : {}) } });
  await audit(adminId, "quiz.open", round.name);
  refresh(roundId);
}

/**
 * A team saves (or re-saves) its guess for the question the host is showing. Only the current question
 * is editable; the last save from any teammate wins. Caller has checked the team may play.
 */
export async function saveGuess(roundId: string, index: number, raw: unknown, team: { id: string }, userId: string): Promise<LiveResult> {
  const live = await loadLive(roundId);
  if (!live || live.status !== "QUESTION") return { ok: false, error: live?.status === "FINISHED" ? "The round has ended; answers are locked." : "No question is open." };
  if (live.currentIndex !== index) return { ok: false, error: "The host has moved to another question. Your answer was not saved." };
  const value = parseGuess(raw);
  if (value === null) return { ok: false, error: "Enter a single number (digits only, commas allowed)." };
  const ids = parseJson<string[]>(live.questionIds, []);
  const q = await db.question.findUnique({ where: { id: ids[index] } });
  if (!q) return { ok: false, error: "Question not found." };
  const correct = parseJson<unknown>(q.answer, null);
  const points = typeof correct === "number" ? guessPoints(value, correct) : 0;

  await joinLive(roundId, team.id);
  const data = { answer: JSON.stringify(value), correct: points > 0, points, userId };
  await db.liveAnswer.upsert({
    where: { liveId_questionId_teamId: { liveId: live.id, questionId: q.id, teamId: team.id } },
    create: { liveId: live.id, questionId: q.id, teamId: team.id, ...data },
    update: data,
  });
  return { ok: true };
}
