import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getContent } from "@/lib/content";
import { entryBlocker, teamStatus } from "@/lib/rounds";
import { hostState, playerState } from "@/lib/live-quiz";
import { runHostCommand, saveGuess, type HostCommand } from "@/lib/live-quiz-commands";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const HOST_COMMANDS: HostCommand[] = ["open", "goto", "finish", "reopen", "reset"];

/** The signed-in participant's team, if it may play this quiz round; otherwise an error response. */
async function playingTeam(roundId: string) {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ ok: false, error: "Sign in" }, { status: 401 }) };
  const team = user.membership?.team;
  if (user.role !== "PARTICIPANT" || !team) return { error: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }) };
  const round = await db.round.findUnique({ where: { id: roundId } });
  if (!round || round.type !== "QUIZ" || round.status === "DRAFT") return { error: NextResponse.json({ ok: false, error: "Not found" }, { status: 404 }) };
  const content = await getContent();
  const qualified = !!(await db.qualification.findUnique({ where: { roundId_teamId: { roundId, teamId: team.id } } }));
  const blocker = entryBlocker({ round, status: teamStatus(team, team.members.length, content.teamMin), qualified });
  if (blocker) return { error: NextResponse.json({ ok: false, error: blocker }, { status: 403 }) };
  return { user, team };
}

/** Polled about once a second by the host screen (?view=host) and by each team's answer screen. */
export async function GET(req: Request, { params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  if (new URL(req.url).searchParams.get("view") === "host") {
    const user = await getCurrentUser();
    if (user?.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    return NextResponse.json(await hostState(roundId), { headers: NO_STORE });
  }
  const ctx = await playingTeam(roundId);
  if (ctx.error) return ctx.error;
  return NextResponse.json(await playerState(roundId, { id: ctx.team.id, name: ctx.team.name }), { headers: NO_STORE });
}

/**
 * Host commands ({ command, index }) from admins, and answers ({ index, answer }) from teams.
 * Same-origin only: browsers send Origin on POST, and it must match this host.
 */
export async function POST(req: Request, { params }: { params: Promise<{ roundId: string }> }) {
  const { roundId } = await params;
  // Same check Next.js applies to server actions: Origin must match the (forwarded) Host header.
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host && new URL(origin).host !== host) return NextResponse.json({ ok: false, error: "Bad origin" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { command?: string; index?: unknown; answer?: unknown } | null;
  if (!body || !Number.isInteger(body.index)) return NextResponse.json({ ok: false, error: "Bad request" }, { status: 400 });
  const index = body.index as number;

  if (body.command !== undefined) {
    const user = await getCurrentUser();
    if (user?.role !== "ADMIN") return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    if (!HOST_COMMANDS.includes(body.command as HostCommand)) return NextResponse.json({ ok: false, error: "Unknown command" }, { status: 400 });
    return NextResponse.json(await runHostCommand(roundId, body.command as HostCommand, index, user.id), { headers: NO_STORE });
  }

  const ctx = await playingTeam(roundId);
  if (ctx.error) return ctx.error;
  return NextResponse.json(await saveGuess(roundId, index, body.answer, ctx.team, ctx.user.id), { headers: NO_STORE });
}
