import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { resolveStoragePath } from "@/lib/files";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp4: "video/mp4",
  csv: "text/csv",
  zip: "application/zip",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ppt: "application/vnd.ms-powerpoint",
};
const INLINE = new Set(["pdf", "png", "jpg", "jpeg", "webp", "mp4"]);

async function canRead(rel: string) {
  const user = await getCurrentUser();
  if (rel.startsWith("assets/")) {
    const asset = await db.asset.findFirst({ where: { filePath: rel } });
    if (!asset) return false;
    return asset.visibility === "PUBLIC" || !!user;
  }
  if (!user) return false;
  if (user.role === "ADMIN") return true;
  if (rel.startsWith("rounds/")) return true; // round briefs and templates: any logged-in user
  const teamMatch = rel.match(/^teams\/([^/]+)\//);
  if (teamMatch) {
    if (user.membership?.teamId === teamMatch[1]) return true;
    if (user.role === "JUDGE") {
      // judges see only submissions of teams assigned to them, never payment proofs
      if (rel.includes("/payment/")) return false;
      return !!(await db.judgeAssignment.findFirst({ where: { judgeId: user.id, teamId: teamMatch[1] } }));
    }
  }
  return false;
}

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const rel = path.map(decodeURIComponent).join("/");
  if (!(await canRead(rel))) return new NextResponse("Not found", { status: 404 });
  let data: Buffer;
  try {
    data = await readFile(resolveStoragePath(rel));
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  const ext = (rel.split(".").pop() ?? "").toLowerCase();
  const name = rel.split("/").pop()!.replace(/^\d+-/, "");
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Disposition": `${INLINE.has(ext) ? "inline" : "attachment"}; filename="${name}"`,
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
