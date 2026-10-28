import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { type DB, newId } from "./db";
import { HttpError, type AuthContext } from "./auth";
import { audit } from "./audit";
import { recordEvent, requireComplaint, canView } from "./complaints";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_COMPLAINT = 25;

/** Allowed types are detected from the file's own bytes, never from the name or declared type. */
const SIGNATURES: { mime: string; ext: string[]; test: (b: Buffer) => boolean }[] = [
  { mime: "image/png", ext: ["png"], test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", ext: ["jpg", "jpeg"], test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/gif", ext: ["gif"], test: (b) => b.subarray(0, 4).toString("latin1") === "GIF8" },
  { mime: "image/webp", ext: ["webp"], test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
  { mime: "application/pdf", ext: ["pdf"], test: (b) => b.subarray(0, 5).toString("latin1") === "%PDF-" },
  { mime: "text/plain", ext: ["txt", "log"], test: (b) => !b.subarray(0, 4096).includes(0) && isMostlyText(b) },
  { mime: "application/zip", ext: ["docx", "xlsx"], test: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5) },
];

function isMostlyText(b: Buffer): boolean {
  const s = b.subarray(0, 4096);
  let bad = 0;
  for (const c of s) if (c < 9 || (c > 13 && c < 32)) bad++;
  return bad / Math.max(1, s.length) < 0.02;
}

export function detectType(filename: string, data: Buffer): { mime: string } | null {
  const ext = path.extname(filename).slice(1).toLowerCase();
  const sig = SIGNATURES.find((s) => s.ext.includes(ext) && s.test(data));
  return sig ? { mime: sig.mime } : null;
}

export function storageDir(): string {
  const dir = path.resolve(process.env.STORAGE_DIR ?? "./storage");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function safeFilename(name: string): string {
  const base = path.basename(name).replace(/[^\w.\- ]+/g, "_").replace(/\.{2,}/g, ".").slice(0, 120);
  return base || "file";
}

export interface SaveInput {
  orgId: string;
  complaintId: string;
  filename: string;
  data: Buffer;
  uploader: { kind: "user"; id: string; name: string } | { kind: "complainant" };
  visibility: "public" | "internal";
  now?: number;
}

/** Stores a file privately (random name, outside any web root). Returns the attachment id. */
export function saveAttachment(db: DB, s: SaveInput): { id: string; filename: string } {
  const now = s.now ?? Date.now();
  if (s.data.length === 0) throw new HttpError(422, "That file is empty.");
  if (s.data.length > MAX_UPLOAD_BYTES) throw new HttpError(413, `Files can be at most ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  const type = detectType(s.filename, s.data);
  if (!type) throw new HttpError(415, "This file type is not allowed. Use PNG, JPG, GIF, WebP, PDF, TXT, DOCX or XLSX.");
  const count = (db.prepare("SELECT COUNT(*) n FROM attachments WHERE complaint_id = ?").get(s.complaintId) as { n: number }).n;
  if (count >= MAX_FILES_PER_COMPLAINT) throw new HttpError(422, "This complaint has reached the maximum number of attachments.");
  const id = newId();
  const key = crypto.randomBytes(24).toString("hex");
  const dir = storageDir();
  fs.writeFileSync(path.join(dir, key), s.data, { mode: 0o600 });
  const filename = safeFilename(s.filename);
  try {
    db.transaction(() => {
      db.prepare("INSERT INTO attachments (id, org_id, complaint_id, uploader_kind, uploader_id, filename, mime, size, sha256, storage_key, visibility, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(
        id, s.orgId, s.complaintId, s.uploader.kind, s.uploader.kind === "user" ? s.uploader.id : null, filename, type.mime, s.data.length, crypto.createHash("sha256").update(s.data).digest("hex"), key, s.visibility, now,
      );
      recordEvent(db, { orgId: s.orgId, complaintId: s.complaintId, type: "attachment", actorKind: s.uploader.kind, actorId: s.uploader.kind === "user" ? s.uploader.id : null, actorName: s.uploader.kind === "user" ? s.uploader.name : "Complainant", visibility: s.visibility, body: `Uploaded ${filename}`, data: { attachmentId: id }, now });
      audit(db, { orgId: s.orgId, actorId: s.uploader.kind === "user" ? s.uploader.id : null, actorLabel: s.uploader.kind, action: "attachment.uploaded", entityType: "complaint", entityId: s.complaintId, data: { attachmentId: id, size: s.data.length }, now });
    })();
  } catch (e) {
    fs.rmSync(path.join(dir, key), { force: true });
    throw e;
  }
  return { id, filename };
}

export function uploadAsStaff(db: DB, ctx: AuthContext, complaintId: string, filename: string, data: Buffer, visibility: "public" | "internal"): { id: string } {
  if (!ctx.perms.has("complaint.evidence.upload")) throw new HttpError(403, "You do not have permission to upload evidence.");
  requireComplaint(db, ctx, complaintId);
  return saveAttachment(db, { orgId: ctx.orgId, complaintId, filename, data, uploader: { kind: "user", id: ctx.userId, name: ctx.name }, visibility });
}

/** Permission-checked read. Every download re-checks access; there are no standing public links. */
export function readAttachmentForUser(db: DB, ctx: AuthContext, attachmentId: string): { filename: string; mime: string; data: Buffer } {
  const a = db.prepare("SELECT * FROM attachments WHERE id = ? AND org_id = ?").get(attachmentId, ctx.orgId) as any;
  if (!a) throw new HttpError(404, "File not found.");
  const c = requireComplaint(db, ctx, a.complaint_id);
  const staff = ctx.perms.has("complaint.view.all") || (ctx.perms.has("complaint.view.assigned") && canView(ctx, c));
  if (a.visibility === "internal" && !staff) throw new HttpError(404, "File not found.");
  audit(db, { orgId: ctx.orgId, actorId: ctx.userId, actorLabel: ctx.email, action: "attachment.downloaded", entityType: "attachment", entityId: attachmentId });
  return { filename: a.filename, mime: a.mime, data: fs.readFileSync(path.join(storageDir(), a.storage_key)) };
}
