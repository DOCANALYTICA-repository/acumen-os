import "server-only";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

export const STORAGE_ROOT = path.join(process.cwd(), "storage");

export type StoredFile = { path: string; name: string; size: number; type: string };

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-120) || "file";
}

/** Saves an uploaded File under storage/<dir>/ and returns its storage-relative path. */
export async function saveUpload(file: File, dir: string): Promise<StoredFile> {
  const cleanDir = dir.split("/").map(safeName).join("/");
  const rel = `${cleanDir}/${Date.now()}-${safeName(file.name)}`;
  const abs = path.join(STORAGE_ROOT, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, Buffer.from(await file.arrayBuffer()));
  return { path: rel, name: file.name, size: file.size, type: file.type };
}

export function resolveStoragePath(rel: string) {
  const abs = path.normalize(path.join(STORAGE_ROOT, rel));
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
