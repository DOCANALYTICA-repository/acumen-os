import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { hostState } from "@/lib/live-quiz";
import { HostScreen } from "./host-screen";

/** Projector view for running a live quiz. Admin only. */
export default async function HostPage({ params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  await requireAdmin();
  const round = await db.round.findUnique({ where: { id: roundId } });
  if (!round || round.type !== "QUIZ") notFound();
  return <HostScreen roundId={round.id} roundName={round.name} roundOrder={round.order} initial={await hostState(round.id)} />;
}
