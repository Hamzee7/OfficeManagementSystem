import { type DB, newId } from "./db";
import { HttpError } from "./auth";
import { allow } from "./ratelimit";
import { audit } from "./audit";
import { hashAccessCode, recordEvent, transitionComplaint, getComplaintRow, type ComplaintRow } from "./complaints";
import { notifyUser, usersWithPermission } from "./notify";
import { loadOrg } from "./org";
import { saveAttachment } from "./storage";
import fs from "node:fs";
import path from "node:path";
import { storageDir } from "./storage";
import crypto from "node:crypto";

/**
 * Public tracking. A reference number alone reveals nothing: the caller must also present the
 * access code that was shown (and emailed) once at submission. Failures are rate limited and
 * all give the same answer so references cannot be probed.
 */
export function verifyAccess(db: DB, ref: string, code: string, ip: string, now = Date.now()): ComplaintRow {
  if (!allow(db, `track:ip:${ip}`, 40, 15 * 60_000, now) || !allow(db, `track:ref:${ref.toUpperCase()}`, 10, 15 * 60_000, now)) {
    throw new HttpError(429, "Too many attempts. Please wait a few minutes and try again.");
  }
  const generic = new HttpError(404, "We could not find a complaint with that reference and access code.");
  const c = db.prepare("SELECT * FROM complaints WHERE upper(ref) = upper(?)").get(ref.trim()) as ComplaintRow | undefined;
  const given = Buffer.from(hashAccessCode(code), "hex");
  const stored = Buffer.from(c ? (db.prepare("SELECT access_code_hash h FROM complaints WHERE id = ?").get(c.id) as { h: string }).h : "0".repeat(64), "hex");
  const same = given.length === stored.length && crypto.timingSafeEqual(given, stored);
  if (!c || !same) throw generic;
  return c;
}

export function publicView(db: DB, c: ComplaintRow) {
  const events = db.prepare("SELECT type, actor_kind, actor_name, body, created_at FROM complaint_events WHERE complaint_id = ? AND visibility = 'public' ORDER BY created_at, rowid").all(c.id) as any[];
  const attachments = db.prepare("SELECT id, filename, size, created_at FROM attachments WHERE complaint_id = ? AND visibility = 'public' ORDER BY created_at").all(c.id) as any[];
  const survey = db.prepare("SELECT rating FROM surveys WHERE complaint_id = ?").get(c.id) as { rating: number } | undefined;
  return {
    ref: c.ref, title: c.title, status: c.status, createdAt: c.created_at, updatedAt: c.updated_at,
    // Only the outcome is shared, never internal text. Staff names are not exposed.
    resolution: c.status === "Resolved" || c.status === "Closed" ? c.resolution_summary : null,
    respondBy: c.first_response_due_at,
    waitingForYou: c.status === "Awaiting Complainant",
    canReopen: c.status === "Resolved",
    canGiveFeedback: (c.status === "Resolved" || c.status === "Closed") && !survey,
    feedbackGiven: !!survey,
    events: events.map((e) => ({ type: e.type, from: e.actor_kind === "complainant" ? "You" : e.actor_kind === "system" ? "System" : "Support team", body: e.body, at: e.created_at })),
    attachments,
  };
}

function notifyStaff(db: DB, c: ComplaintRow, title: string, now: number, key: string): void {
  const link = `/complaints/${c.id}`;
  const targets = new Set<string>();
  if (c.assignee_id) targets.add(c.assignee_id);
  else for (const m of usersWithPermission(db, c.org_id, "complaint.assign")) targets.add(m.id);
  for (const uid of targets) notifyUser(db, { orgId: c.org_id, userId: uid, type: "complainant_reply", title: `${c.ref}: ${title}`, link, dedupeKey: key, now });
}

export function complainantMessage(db: DB, c: ComplaintRow, body: string, now = Date.now()): void {
  const text = body.trim();
  if (!text) throw new HttpError(422, "Write a message first.");
  if (text.length > 5000) throw new HttpError(422, "Message is too long.");
  if (["Closed", "Rejected"].includes(c.status)) throw new HttpError(409, "This complaint is closed. You can no longer add messages.");
  db.transaction(() => {
    recordEvent(db, { orgId: c.org_id, complaintId: c.id, type: "message", actorKind: "complainant", actorName: "Complainant", visibility: "public", body: text, now });
    db.prepare("UPDATE complaints SET updated_at = ?, version = version + 1 WHERE id = ?").run(now, c.id);
  }).immediate();
  if (c.status === "Awaiting Complainant") {
    // The complainant answered: the SLA clock resumes and the handler is told.
    transitionComplaint(db, null, c.id, "Investigation in Progress", { orgId: c.org_id, comment: "Complainant replied.", actorOverride: { kind: "system" }, now });
  }
  notifyStaff(db, c, "complainant replied", now, `reply:${c.id}:${now}`);
}

export function complainantReopen(db: DB, c: ComplaintRow, reason: string, now = Date.now()): void {
  if (c.status !== "Resolved") throw new HttpError(409, "Only a resolved complaint can be reopened.");
  const org = loadOrg(db, c.org_id);
  void org;
  transitionComplaint(db, null, c.id, "Reopened", { orgId: c.org_id, comment: reason, actorOverride: { kind: "complainant" }, now });
  audit(db, { orgId: c.org_id, actorLabel: "complainant", action: "complaint.reopen_requested", entityType: "complaint", entityId: c.id, now });
}

export function complainantFeedback(db: DB, c: ComplaintRow, rating: number, comment: string, now = Date.now()): void {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(422, "Choose a rating from 1 to 5.");
  if (c.status !== "Resolved" && c.status !== "Closed") throw new HttpError(409, "Feedback opens once the complaint is resolved.");
  const r = db.prepare("INSERT INTO surveys (id, org_id, complaint_id, rating, comment, created_at) VALUES (?,?,?,?,?,?) ON CONFLICT (complaint_id) DO NOTHING").run(newId(), c.org_id, c.id, rating, comment.trim().slice(0, 2000) || null, now);
  if (r.changes === 0) throw new HttpError(409, "Feedback was already submitted.");
  recordEvent(db, { orgId: c.org_id, complaintId: c.id, type: "feedback", actorKind: "complainant", actorName: "Complainant", visibility: "internal", body: `Satisfaction rating: ${rating}/5`, now });
}

export function complainantUpload(db: DB, c: ComplaintRow, filename: string, data: Buffer, now = Date.now()): { id: string } {
  if (["Closed", "Rejected"].includes(c.status)) throw new HttpError(409, "This complaint is closed.");
  return saveAttachment(db, { orgId: c.org_id, complaintId: c.id, filename, data, uploader: { kind: "complainant" }, visibility: "public", now });
}

export function readAttachmentForComplainant(db: DB, c: ComplaintRow, attachmentId: string): { filename: string; mime: string; data: Buffer } {
  const a = db.prepare("SELECT * FROM attachments WHERE id = ? AND complaint_id = ? AND visibility = 'public'").get(attachmentId, c.id) as any;
  if (!a) throw new HttpError(404, "File not found.");
  return { filename: a.filename, mime: a.mime, data: fs.readFileSync(path.join(storageDir(), a.storage_key)) };
}

export { getComplaintRow };
