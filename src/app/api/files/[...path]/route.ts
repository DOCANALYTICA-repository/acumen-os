import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readStoredFile } from "@/lib/files";

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

/** Only payment proofs are stored on the site: readable by organisers and the team's own members. */
async function canRead(rel: string) {
  const user = await getCurrentUser();
  if (!user) return false;
  const m = rel.match(/^teams\/([^/]+)\/payment\//);
  if (!m) return false;
  return user.role === "ADMIN" || user.membership?.teamId === m[1];
}

export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const rel = path.map(decodeURIComponent).join("/");
  if (!(await canRead(rel))) return new NextResponse("Not found", { status: 404 });
  let data: Buffer;
  try {
    data = await readStoredFile(rel);
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
