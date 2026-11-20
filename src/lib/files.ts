import "server-only";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

/** Local-disk uploads (development, or when Supabase Storage isn't configured). */
export const STORAGE_ROOT = path.resolve(process.env.STORAGE_DIR || path.join(process.cwd(), "storage"));

export type StoredFile = { path: string; name: string; size: number; type: string };

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-120) || "file";
}

/**
 * Where files go. With SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set (deployed), uploads live in a
 * private Supabase Storage bucket (SUPABASE_BUCKET, default "uploads"); otherwise on local disk.
 * Files are always served through /api/files, which checks who may read them.
 */
function supabase() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { base: `${url}/storage/v1/object/${process.env.SUPABASE_BUCKET || "uploads"}`, headers: { Authorization: `Bearer ${key}`, apikey: key } };
}

/** Rejects absolute paths and any ".." segment so a stored path can't escape its folder or bucket. */
function checkRel(rel: string) {
  if (!rel || rel.startsWith("/") || rel.includes("\\") || rel.split("/").some((p) => p === ".." || p === "." || p === "")) throw new Error("Invalid path");
  return rel;
}

function objectUrl(base: string, rel: string) {
  return `${base}/${checkRel(rel).split("/").map(encodeURIComponent).join("/")}`;
}

/** Saves an uploaded File under <dir>/ and returns its storage-relative path. */
export async function saveUpload(file: File, dir: string): Promise<StoredFile> {
  const cleanDir = dir.split("/").map(safeName).join("/");
  const rel = `${cleanDir}/${Date.now()}-${safeName(file.name)}`;
  const body = Buffer.from(await file.arrayBuffer());
  const sb = supabase();
  if (sb) {
    const res = await fetch(objectUrl(sb.base, rel), {
      method: "POST",
      headers: { ...sb.headers, "Content-Type": file.type || "application/octet-stream", "x-upsert": "false" },
      body,
    });
    if (!res.ok) throw new Error(`Upload failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  } else {
    const abs = resolveStoragePath(rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, body);
  }
  return { path: rel, name: file.name, size: file.size, type: file.type };
}

/** Reads a stored file. Throws if it doesn't exist. */
export async function readStoredFile(rel: string): Promise<Buffer> {
  const sb = supabase();
  if (!sb) return readFile(resolveStoragePath(rel));
  const res = await fetch(objectUrl(sb.base, rel), { headers: sb.headers, cache: "no-store" });
  if (!res.ok) throw new Error(`Not found (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/** Deletes a stored file; missing files are ignored. */
export async function deleteStoredFile(rel: string) {
  const sb = supabase();
  if (!sb) return unlink(resolveStoragePath(rel)).catch(() => {});
  await fetch(sb.base, {
    method: "DELETE",
    headers: { ...sb.headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: [checkRel(rel)] }),
  }).catch(() => {});
}

function resolveStoragePath(rel: string) {
  const abs = path.normalize(path.join(STORAGE_ROOT, checkRel(rel)));
  if (!abs.startsWith(STORAGE_ROOT + path.sep)) throw new Error("Invalid path");
  return abs;
}

export function fileUrl(rel: string | null | undefined) {
  return rel ? `/api/files/${rel.split("/").map(encodeURIComponent).join("/")}` : "";
}

export function extOf(name: string) {
  return (name.split(".").pop() ?? "").toLowerCase();
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
