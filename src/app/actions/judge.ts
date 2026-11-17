"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db, audit } from "@/lib/db";
import { requireRole } from "@/lib/auth";

export async function saveScores(fd: FormData) {
  const judge = await requireRole("JUDGE", "ADMIN");
  const roundId = String(fd.get("roundId"));
  const teamId = String(fd.get("teamId"));
  if (judge.role === "JUDGE") {
    const assigned = await db.judgeAssignment.findFirst({ where: { roundId, teamId, judgeId: judge.id } });
    if (!assigned) throw new Error("This submission is not assigned to you.");
  } else {
    // admins scoring directly are recorded as an assignment so the score is visible everywhere
    await db.judgeAssignment.upsert({
      where: { roundId_teamId_judgeId: { roundId, teamId, judgeId: judge.id } },
      create: { roundId, teamId, judgeId: judge.id },
      update: {},
    });
  }
  const criteria = await db.rubricCriterion.findMany({ where: { roundId } });
  const comment = String(fd.get("comment") ?? "").trim().slice(0, 2000);
  for (const c of criteria) {
    const raw = Number(fd.get(`c_${c.id}`));
    const marks = Math.min(c.maxMarks, Math.max(0, Number.isFinite(raw) ? raw : 0));
    await db.score.upsert({
      where: { roundId_teamId_judgeId_criterionId: { roundId, teamId, judgeId: judge.id, criterionId: c.id } },
      create: { roundId, teamId, judgeId: judge.id, criterionId: c.id, marks, comment },
      update: { marks, comment },
    });
  }
  await audit(judge.id, "judging.score", `${roundId}:${teamId}`);
  revalidatePath("/judge");
  revalidatePath("/admin/submissions");
  redirect(judge.role === "ADMIN" ? `/admin/submissions?round=${roundId}` : "/judge");
}
