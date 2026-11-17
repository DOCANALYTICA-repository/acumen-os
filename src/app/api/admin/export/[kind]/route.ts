import { NextResponse } from "next/server";
import { db, parseJson } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { getContent } from "@/lib/content";
import { teamStatus, TEAM_STATUS_LABEL } from "@/lib/rounds";
import { computeLeaderboard } from "@/lib/scoring";
import type { StoredFile } from "@/lib/files";

function csv(rows: (string | number | null | undefined)[][]) {
  // prefix formula-like cells so spreadsheets don't execute them
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
}

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const user = await getCurrentUser();
  if (user?.role !== "ADMIN") return new NextResponse("Forbidden", { status: 403 });
  const { kind } = await params;
  const rows: (string | number | null | undefined)[][] = [];

  if (kind === "teams") {
    const content = await getContent();
    const teams = await db.team.findMany({ include: { members: { include: { user: true } } }, orderBy: { name: "asc" } });
    rows.push(["team", "status", "payment_status", "transaction_id", "member_name", "is_lead", "email", "phone", "college", "year", "city"]);
    for (const t of teams)
      for (const m of t.members)
        rows.push([t.name, TEAM_STATUS_LABEL[teamStatus(t, t.members.length, content.teamMin)], t.paymentStatus, t.transactionId, m.user.fullName, m.isLead ? "yes" : "", m.user.email, m.user.phone, m.user.college, m.user.year, m.user.city]);
  } else if (kind === "participants") {
    const users = await db.user.findMany({ where: { role: "PARTICIPANT" }, include: { membership: { include: { team: true } } }, orderBy: { createdAt: "asc" } });
    rows.push(["name", "email", "phone", "college", "year", "city", "source", "team", "registered_at"]);
    for (const u of users) rows.push([u.fullName, u.email, u.phone, u.college, u.year, u.city, u.source, u.membership?.team.name, u.createdAt.toISOString()]);
  } else if (kind === "leaderboard") {
    const { rounds, rows: board } = await computeLeaderboard();
    rows.push(["rank", "team", "college", ...rounds.map((r) => r.name), "overall"]);
    for (const r of board) rows.push([r.rank, r.teamName, r.college, ...rounds.map((x) => r.perRound[x.id]?.toFixed(2) ?? ""), r.overall.toFixed(2)]);
  } else if (kind === "submissions") {
    const roundId = new URL(req.url).searchParams.get("round") ?? undefined;
    const subs = await db.submission.findMany({ where: { roundId }, include: { team: true, round: true, uploadedBy: true }, orderBy: [{ roundId: "asc" }, { teamId: "asc" }, { version: "desc" }] });
    rows.push(["round", "team", "version", "title", "uploaded_by", "submitted_at", "late", "files"]);
    for (const s of subs) rows.push([s.round.name, s.team.name, s.version, s.title, s.uploadedBy.fullName, s.submittedAt.toISOString(), s.isLate ? "yes" : "", parseJson<StoredFile[]>(s.files, []).map((f) => f.name).join("; ")]);
  } else return new NextResponse("Unknown export", { status: 404 });

  return new NextResponse(csv(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="acumen-${kind}.csv"` },
  });
}
