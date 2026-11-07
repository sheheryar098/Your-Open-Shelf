import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { query, queryOne, type Db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { policy, uploadDir } from "@/server/config";

export type FileKind = "listing_photo" | "avatar" | "proof_of_postage" | "evidence";

const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", ext: "webp", test: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
  { mime: "application/pdf", ext: "pdf", test: (b) => b.subarray(0, 5).toString() === "%PDF-" },
];

const ALLOWED: Record<FileKind, string[]> = {
  listing_photo: ["image/jpeg", "image/png", "image/webp"],
  avatar: ["image/jpeg", "image/png", "image/webp"],
  proof_of_postage: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  evidence: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
};

/**
 * Hook for malware scanning (§18.4). Plug in a scanning service here before accepting
 * files in production; returning false rejects the upload.
 */
async function scan(_buf: Buffer, _mime: string): Promise<boolean> {
  return true;
}

export async function saveUpload(db: Db, file: File, kind: FileKind, ownerId: string): Promise<string> {
  if (!file || typeof file.arrayBuffer !== "function" || file.size === 0) throw new DomainError("Choose a file to upload.");
  if (file.size > policy.maxUploadBytes) throw new DomainError("Files must be 5 MB or smaller.");
  const buf = Buffer.from(await file.arrayBuffer());
  return saveBuffer(db, buf, kind, ownerId);
}

export async function saveBuffer(db: Db, buf: Buffer, kind: FileKind, ownerId: string | null): Promise<string> {
  const sig = SIGNATURES.find((s) => s.test(buf));
  if (!sig || !ALLOWED[kind].includes(sig.mime)) {
    throw new DomainError(kind === "listing_photo" || kind === "avatar"
      ? "Photos must be JPEG, PNG or WebP images."
      : "Files must be JPEG, PNG, WebP images or PDF documents.");
  }
  if (!(await scan(buf, sig.mime))) throw new DomainError("This file was rejected by our security checks.");
  const id = randomUUID();
  const key = `${kind}/${id}.${sig.ext}`;
  const full = path.resolve(uploadDir(), key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, buf);
  await query(
    "INSERT INTO files (id, owner_id, kind, storage_key, mime, size_bytes) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, ownerId, kind, key, sig.mime, buf.length],
    db,
  );
  return id;
}

export interface FileRow {
  id: string;
  owner_id: string | null;
  kind: FileKind;
  storage_key: string;
  mime: string;
  size_bytes: number;
}

export async function getFile(id: string) {
  return queryOne<FileRow>("SELECT * FROM files WHERE id = $1", [id]);
}

export async function readStored(row: FileRow): Promise<Buffer> {
  const base = path.resolve(uploadDir());
  const full = path.resolve(base, row.storage_key);
  if (!full.startsWith(base + path.sep)) throw new Error("Invalid storage key");
  return readFile(full);
}

/**
 * Who may view a stored file. Listing photos and avatars are public; proof of postage and
 * dispute evidence are visible only to the exchange parties and staff.
 */
export async function canViewFile(row: FileRow, viewer: { id: string; role: string } | null): Promise<boolean> {
  if (row.kind === "listing_photo" || row.kind === "avatar") return true;
  if (!viewer) return false;
  if (viewer.role === "admin" || viewer.role === "moderator") return true;
  if (row.owner_id === viewer.id) return true;
  const party = await queryOne(
    `SELECT 1 FROM exchanges e
     WHERE (e.requester_id = $2 OR e.sender_id = $2)
       AND (e.id IN (SELECT exchange_id FROM shipments WHERE proof_file_id = $1)
         OR e.id IN (SELECT d.exchange_id FROM dispute_messages m JOIN disputes d ON d.id = m.dispute_id
                     WHERE m.file_id = $1 AND NOT m.internal))`,
    [row.id, viewer.id],
  );
  return !!party;
}
