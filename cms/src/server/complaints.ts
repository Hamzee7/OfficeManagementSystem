import crypto from "node:crypto";
import { type DB, newId, sha256, nextCounter } from "./db";
import { audit } from "./audit";
import { HttpError, type AuthContext } from "./auth";
import { loadCalendar, loadOrg, loadTransitions } from "./org";
import { notifyUser, queueEmail, usersWithPermission } from "./notify";
import { checkTransition, type Status, type Actor, STATUSES, OPEN_STATUSES } from "@/lib/workflow";
import { addBusinessMinutes, businessMinutesBetween } from "@/lib/calendar";
import { computeDeadlines, pauseClock, resumeClock, scaledPolicy, slaSnapshot, type Priority, PRIORITIES, type SlaSnapshot } from "@/lib/sla";
import { recommendAssignment, type Candidate } from "@/lib/assignment";
import { getAiProvider } from "@/lib/ai";

export interface ComplaintRow {
  id: string; org_id: string; ref: string; title: string; description: string;
  category_id: string | null; department_id: string | null; location_id: string | null;
  incident_at: number | null; channel: string; priority: Priority; status: Status; sensitive: number;
  related_ref: string | null; complainant_user_id: string | null; complainant_name: string | null;
  complainant_email: string | null; complainant_phone: string | null; contact_method: string; is_anonymous: number;
  assignee_id: string | null; resolution_summary: string | null; reopen_count: number; version: number;
  created_at: number; updated_at: number; acknowledged_at: number | null; first_response_at: number | null;
  resolved_at: number | null; closed_at: number | null; ack_due_at: number | null; first_response_due_at: number | null;
  resolution_due_at: number | null; sla_total_minutes: number; sla_paused_at: number | null; sla_paused_remaining_minutes: number | null;
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no look-alike characters

export function generateAccessCode(): string {
  const bytes = crypto.randomBytes(12);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((c) => c.join("")).join("-");
}
export const hashAccessCode = (code: string) => sha256("access:" + code.toUpperCase().replace(/[^A-Z0-9]/g, ""));

export function recordEvent(
  db: DB,
  e: { orgId: string; complaintId: string; type: string; actorKind: "user" | "complainant" | "system"; actorId?: string | null; actorName?: string | null; visibility: "public" | "internal"; body?: string | null; data?: unknown; now?: number },
): void {
  db.prepare("INSERT INTO complaint_events (id, org_id, complaint_id, type, actor_kind, actor_id, actor_name, visibility, body, data, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
    newId(), e.orgId, e.complaintId, e.type, e.actorKind, e.actorId ?? null, e.actorName ?? null, e.visibility, e.body ?? null, e.data ? JSON.stringify(e.data) : null, e.now ?? Date.now(),
  );
}

export function getComplaintRow(db: DB, orgId: string, id: string): ComplaintRow | undefined {
  return db.prepare("SELECT * FROM complaints WHERE id = ? AND org_id = ?").get(id, orgId) as ComplaintRow | undefined;
}

/** Row-level visibility. Used for every read; hiding UI is never the only protection. */
export function canView(ctx: AuthContext, c: Pick<ComplaintRow, "assignee_id" | "complainant_user_id" | "org_id">): boolean {
  if (c.org_id !== ctx.orgId) return false;
  if (ctx.perms.has("complaint.view.all")) return true;
  if (ctx.perms.has("complaint.view.assigned") && c.assignee_id === ctx.userId) return true;
  return c.complainant_user_id === ctx.userId;
}

export function requireComplaint(db: DB, ctx: AuthContext, id: string): ComplaintRow {
  const c = getComplaintRow(db, ctx.orgId, id);
  // 404 (not 403) so the existence of other people's complaints is not revealed.
  if (!c || !canView(ctx, c)) throw new HttpError(404, "Complaint not found.");
  return c;
}

export function scopeSql(ctx: AuthContext, alias = "c"): { sql: string; params: unknown[] } {
  if (ctx.perms.has("complaint.view.all")) return { sql: `${alias}.org_id = ?`, params: [ctx.orgId] };
  if (ctx.perms.has("complaint.view.assigned")) return { sql: `${alias}.org_id = ? AND (${alias}.assignee_id = ? OR ${alias}.complainant_user_id = ?)`, params: [ctx.orgId, ctx.userId, ctx.userId] };
  return { sql: `${alias}.org_id = ? AND ${alias}.complainant_user_id = ?`, params: [ctx.orgId, ctx.userId] };
}

export function slaFor(db: DB, c: ComplaintRow, now = Date.now(), cal = loadCalendar(db, c.org_id), atRiskPct = 75): SlaSnapshot {
  return slaSnapshot(
    { createdAt: c.created_at, resolutionDueAt: c.resolution_due_at, resolutionMinutes: c.sla_total_minutes, pausedAt: c.sla_paused_at, pausedRemainingMinutes: c.sla_paused_remaining_minutes, resolvedAt: c.resolved_at, closedAt: c.closed_at, atRiskPct },
    now, cal,
  );
}

// ---------------------------------------------------------------- submission

export interface SubmitInput {
  title: string;
  description: string;
  categoryId?: string | null;
  departmentId?: string | null;
  locationId?: string | null;
  incidentAt?: number | null;
  channel?: "web" | "email" | "phone" | "walk_in" | "social" | "other";
  priority?: Priority | null;
  relatedRef?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  contactMethod?: "email" | "sms" | "none";
  anonymous?: boolean;
  consent: boolean;
  complainantUserId?: string | null;
  createdBy?: AuthContext | null; // staff logging on behalf of someone
  now?: number;
}

export interface SubmitResult { id: string; ref: string; accessCode: string; status: Status; assigneeId: string | null }

export function submitComplaint(db: DB, orgId: string, input: SubmitInput): SubmitResult {
  const now = input.now ?? Date.now();
  const org = loadOrg(db, orgId);
  const title = input.title.trim();
  const description = input.description.trim();
  if (title.length < 5 || title.length > 150) throw new HttpError(422, "Title must be between 5 and 150 characters.");
  if (description.length < 20) throw new HttpError(422, "Please describe what happened in at least 20 characters.");
  if (description.length > 10_000) throw new HttpError(422, "Description is too long (10,000 characters maximum).");
  if (!input.consent) throw new HttpError(422, "Consent to the privacy notice is required to submit a complaint.");
  const anonymous = !!input.anonymous;
  if (anonymous && !org.allowAnonymous) throw new HttpError(422, "This organization does not accept anonymous complaints.");
  const email = anonymous ? null : (input.email ?? "").trim().toLowerCase() || null;
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(422, "That email address does not look valid.");
  const method = anonymous ? "none" : input.contactMethod ?? (email ? "email" : "none");
  if (method === "email" && !email) throw new HttpError(422, "Add an email address, or choose not to be contacted.");
  if (method === "sms" && !(input.phone ?? "").trim()) throw new HttpError(422, "Add a phone number for SMS contact.");

  const cat = input.categoryId ? (db.prepare("SELECT * FROM categories WHERE id = ? AND org_id = ? AND active = 1").get(input.categoryId, orgId) as any) : null;
  if (input.categoryId && !cat) throw new HttpError(422, "Unknown category.");
  const dept = input.departmentId ? db.prepare("SELECT id FROM departments WHERE id = ? AND org_id = ?").get(input.departmentId, orgId) : null;
  if (input.departmentId && !dept) throw new HttpError(422, "Unknown department.");
  if (input.locationId && !db.prepare("SELECT id FROM locations WHERE id = ? AND org_id = ?").get(input.locationId, orgId)) throw new HttpError(422, "Unknown location.");
  if (input.priority && !PRIORITIES.includes(input.priority)) throw new HttpError(422, "Unknown priority.");
  if (input.incidentAt && input.incidentAt > now + 60_000) throw new HttpError(422, "The incident date cannot be in the future.");

  const ai = org.aiEnabled ? getAiProvider() : null;
  const fullText = `${title}\n${description}`;
  let categoryId: string | null = cat?.id ?? null;
  let aiCategory: ReturnType<NonNullable<typeof ai>["suggestCategory"]> | null = null;
  if (ai && !categoryId) {
    const options = (db.prepare("SELECT id, name, keywords FROM categories WHERE org_id = ? AND active = 1").all(orgId) as any[]).map((c) => ({ id: c.id, name: c.name, keywords: JSON.parse(c.keywords) as string[] }));
    aiCategory = ai.suggestCategory(fullText, options);
    if (aiCategory.categoryId && aiCategory.confidence >= 0.45) categoryId = aiCategory.categoryId;
  }
  const category = categoryId ? (db.prepare("SELECT * FROM categories WHERE id = ?").get(categoryId) as any) : null;
  const aiPriority = ai ? ai.suggestPriority(fullText) : null;
  const sensitive = !!(category?.sensitive || aiPriority?.flagForHumanReview);
  const priority: Priority = input.priority ?? (category?.default_priority as Priority) ?? "Medium";
  const departmentId = input.departmentId ?? category?.department_id ?? null;

  const policy = { ackMinutes: category?.ack_minutes ?? 480, firstResponseMinutes: category?.first_response_minutes ?? 960, resolutionMinutes: category?.resolution_minutes ?? 4800, atRiskPct: org.atRiskPct };
  const cal = loadCalendar(db, orgId);
  const dl = computeDeadlines(now, policy, priority, cal);
  const accessCode = generateAccessCode();
  const id = newId();

  const tx = db.transaction(() => {
    const seq = nextCounter(db, orgId, "complaint_ref");
    const ref = `${org.refPrefix}-${new Date(now).getUTCFullYear()}-${String(seq).padStart(6, "0")}`;
    db.prepare(
      `INSERT INTO complaints (id, org_id, ref, title, description, category_id, department_id, location_id, incident_at, channel, priority, status, sensitive, related_ref,
        complainant_user_id, complainant_name, complainant_email, complainant_phone, contact_method, is_anonymous, consent_at, access_code_hash,
        created_at, updated_at, ack_due_at, first_response_due_at, resolution_due_at, sla_total_minutes)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'Submitted',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, orgId, ref, title, description, categoryId, departmentId, input.locationId ?? null, input.incidentAt ?? null, input.channel ?? "web", priority, +sensitive, input.relatedRef?.trim() || null,
      input.complainantUserId ?? null, anonymous ? null : input.name?.trim() || null, email, anonymous ? null : input.phone?.trim() || null, method, +anonymous, now, hashAccessCode(accessCode),
      now, now, dl.ackDueAt, dl.firstResponseDueAt, dl.resolutionDueAt, scaledPolicy(policy, priority).resolutionMinutes,
    );
    recordEvent(db, { orgId, complaintId: id, type: "submitted", actorKind: input.createdBy ? "user" : "complainant", actorId: input.createdBy?.userId, actorName: input.createdBy?.name ?? (anonymous ? "Anonymous" : input.name ?? "Complainant"), visibility: "public", body: "Complaint submitted", now });
    if (input.createdBy) recordEvent(db, { orgId, complaintId: id, type: "note", actorKind: "user", actorId: input.createdBy.userId, actorName: input.createdBy.name, visibility: "internal", body: `Logged by staff on behalf of the complainant via ${input.channel ?? "web"}.`, now });

    if (ai && aiCategory) {
      db.prepare("INSERT INTO ai_recommendations (id, org_id, complaint_id, kind, payload, rationale, provider, created_at) VALUES (?,?,?,?,?,?,?,?)").run(newId(), orgId, id, "category", JSON.stringify({ ...aiCategory, applied: categoryId === aiCategory.categoryId }), aiCategory.rationale, ai.name, now);
      if (categoryId === aiCategory.categoryId) recordEvent(db, { orgId, complaintId: id, type: "ai_category", actorKind: "system", visibility: "internal", body: `Category set from an automatic suggestion (${aiCategory.rationale}). Staff can correct it.`, now });
    }
    if (ai && aiPriority) {
      db.prepare("INSERT INTO ai_recommendations (id, org_id, complaint_id, kind, payload, rationale, provider, created_at) VALUES (?,?,?,?,?,?,?,?)").run(newId(), orgId, id, "priority", JSON.stringify(aiPriority), aiPriority.rationale, ai.name, now);
      if (aiPriority.flagForHumanReview) recordEvent(db, { orgId, complaintId: id, type: "flagged", actorKind: "system", visibility: "internal", body: `Flagged for human review: ${aiPriority.rationale}`, now });
    }
    audit(db, { orgId, actorId: input.createdBy?.userId ?? null, actorLabel: input.createdBy?.email ?? "public-portal", action: "complaint.submitted", entityType: "complaint", entityId: id, data: { ref, anonymous, sensitive }, now });
    return ref;
  });
  const ref = tx.immediate();

  // Confirmation to the complainant (never contains internal data).
  const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
  if (method !== "none" && email) {
    queueEmail(db, { orgId, complaintId: id, to: email, template: "acknowledgment", key: "submitted", now, vars: { name: input.name?.trim() || "there", org: org.name, ref, code: accessCode, trackUrl: `${baseUrl}/track`, due: new Date(dl.firstResponseDueAt).toUTCString() } });
  }

  // Triage: assign or hand to the unassigned queue.
  const assigneeId = triage(db, orgId, id, now);
  const status = (getComplaintRow(db, orgId, id) as ComplaintRow).status;
  return { id, ref, accessCode, status, assigneeId };
}

function candidatesFor(db: DB, orgId: string): Candidate[] {
  const rows = db.prepare(
    `SELECT u.id, u.name, u.department_id, u.location, u.skills, u.available, u.last_assigned_at,
       (SELECT COUNT(*) FROM complaints c WHERE c.assignee_id = u.id AND c.status NOT IN ('Resolved','Closed','Rejected','Draft')) AS open_load
     FROM users u JOIN roles r ON r.id = u.role_id
     WHERE u.org_id = ? AND u.is_active = 1
       AND EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = u.role_id AND rp.permission = 'complaint.view.assigned')
       AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = u.role_id AND rp.permission = 'org.manage')`,
  ).all(orgId) as any[];
  return rows.map((r) => ({ id: r.id, name: r.name, departmentId: r.department_id, location: r.location, skills: JSON.parse(r.skills), openLoad: r.open_load, available: !!r.available, lastAssignedAt: r.last_assigned_at }));
}

/** Initial routing right after submission (also used when a complaint is reopened). */
export function triage(db: DB, orgId: string, complaintId: string, now: number): string | null {
  const org = loadOrg(db, orgId);
  const c = getComplaintRow(db, orgId, complaintId)!;
  const locName = c.location_id ? ((db.prepare("SELECT name FROM locations WHERE id = ?").get(c.location_id) as any)?.name as string | undefined) ?? null : null;
  const prev = new Set((db.prepare("SELECT DISTINCT to_user_id FROM assignments WHERE complaint_id = ? AND to_user_id IS NOT NULL").all(complaintId) as any[]).map((r) => r.to_user_id as string));
  const rec = recommendAssignment(
    org.assignmentStrategy,
    { categoryId: c.category_id, departmentId: c.department_id, location: locName, priority: c.priority, sensitive: !!c.sensitive, excludedUserIds: new Set(c.complainant_user_id ? [c.complainant_user_id] : []), previousAssigneeIds: prev },
    candidatesFor(db, orgId),
  );
  const tx = db.transaction(() => {
    if (c.status === "Submitted") {
      db.prepare("UPDATE complaints SET status = 'Under Review', updated_at = ?, version = version + 1 WHERE id = ?").run(now, complaintId);
      recordEvent(db, { orgId, complaintId, type: "status", actorKind: "system", visibility: "public", body: "Under review", data: { from: "Submitted", to: "Under Review" }, now });
    }
    if (rec.autoAssign && rec.userId) {
      applyAssignment(db, { orgId, complaintId, toUserId: rec.userId, byUserId: null, strategy: org.assignmentStrategy, reason: rec.reasons.join(" "), now });
    } else {
      recordEvent(db, { orgId, complaintId, type: "unassigned", actorKind: "system", visibility: "internal", body: rec.reasons.join(" "), now });
    }
  });
  tx.immediate();
  if (!(rec.autoAssign && rec.userId)) {
    const link = `/complaints/${complaintId}`;
    for (const m of usersWithPermission(db, orgId, "complaint.assign")) {
      notifyUser(db, { orgId, userId: m.id, type: "unassigned", title: `${c.ref} needs an owner`, body: rec.reasons.join(" "), link, dedupeKey: `unassigned:${complaintId}`, now });
    }
  }
  return rec.autoAssign ? rec.userId : null;
}

// ---------------------------------------------------------------- assignment

function applyAssignment(db: DB, a: { orgId: string; complaintId: string; toUserId: string; byUserId: string | null; strategy: string; reason?: string; now: number }): void {
  const c = getComplaintRow(db, a.orgId, a.complaintId)!;
  const to = db.prepare("SELECT id, name FROM users WHERE id = ?").get(a.toUserId) as { id: string; name: string };
  db.prepare("INSERT INTO assignments (id, org_id, complaint_id, from_user_id, to_user_id, by_user_id, strategy, reason, created_at) VALUES (?,?,?,?,?,?,?,?,?)").run(newId(), a.orgId, a.complaintId, c.assignee_id, a.toUserId, a.byUserId, a.strategy, a.reason ?? null, a.now);
  const moveToAssigned = c.status === "Under Review" || c.status === "Reopened";
  db.prepare("UPDATE complaints SET assignee_id = ?, status = ?, acknowledged_at = COALESCE(acknowledged_at, ?), updated_at = ?, version = version + 1 WHERE id = ?").run(a.toUserId, moveToAssigned ? "Assigned" : c.status, a.now, a.now, a.complaintId);
  db.prepare("UPDATE users SET last_assigned_at = ? WHERE id = ?").run(a.now, a.toUserId);
  recordEvent(db, { orgId: a.orgId, complaintId: a.complaintId, type: "assignment", actorKind: a.byUserId ? "user" : "system", actorId: a.byUserId, visibility: "internal", body: `Assigned to ${to.name}${a.reason ? ` (${a.reason})` : ""}`, data: { from: c.assignee_id, to: a.toUserId, strategy: a.strategy }, now: a.now });
  if (moveToAssigned) recordEvent(db, { orgId: a.orgId, complaintId: a.complaintId, type: "status", actorKind: a.byUserId ? "user" : "system", actorId: a.byUserId, visibility: "public", body: "Assigned to a handler", data: { from: c.status, to: "Assigned" }, now: a.now });
  notifyUser(db, { orgId: a.orgId, userId: a.toUserId, type: "assignment", title: `${c.ref} assigned to you`, body: c.title, link: `/complaints/${a.complaintId}`, dedupeKey: `assign:${a.complaintId}:${a.now}`, now: a.now });
}

export function assignComplaint(db: DB, ctx: AuthContext, complaintId: string, toUserId: string, reason: string, now = Date.now()): void {
  if (!ctx.perms.has("complaint.assign")) throw new HttpError(403, "You do not have permission to assign complaints.");
  const c = requireComplaint(db, ctx, complaintId);
  if (["Closed", "Rejected", "Resolved"].includes(c.status)) throw new HttpError(409, "This complaint is finished. Reopen it before assigning.");
  const to = db.prepare("SELECT u.id, u.is_active, u.org_id FROM users u WHERE u.id = ?").get(toUserId) as any;
  if (!to || to.org_id !== ctx.orgId || !to.is_active) throw new HttpError(422, "That person cannot be assigned.");
  const canHandle = db.prepare("SELECT 1 FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id WHERE u.id = ? AND rp.permission IN ('complaint.view.assigned','complaint.view.all')").get(toUserId);
  if (!canHandle) throw new HttpError(422, "That person's role cannot handle complaints.");
  if (c.complainant_user_id === toUserId) throw new HttpError(422, "Conflict of interest: a person cannot handle their own complaint.");
  if (c.assignee_id === toUserId) throw new HttpError(409, "Already assigned to that person.");
  if (c.assignee_id && reason.trim().length < 3) throw new HttpError(422, "Give a reason when reassigning.");
  db.transaction(() => {
    applyAssignment(db, { orgId: ctx.orgId, complaintId, toUserId, byUserId: ctx.userId, strategy: "manual", reason: reason.trim() || undefined, now });
    audit(db, { orgId: ctx.orgId, actorId: ctx.userId, actorLabel: ctx.email, action: c.assignee_id ? "complaint.reassigned" : "complaint.assigned", entityType: "complaint", entityId: complaintId, data: { to: toUserId }, now });
  }).immediate();
}

export function recommendFor(db: DB, ctx: AuthContext, complaintId: string) {
  if (!ctx.perms.has("complaint.assign")) throw new HttpError(403, "You do not have permission to assign complaints.");
  const c = requireComplaint(db, ctx, complaintId);
  const org = loadOrg(db, ctx.orgId);
  const locName = c.location_id ? ((db.prepare("SELECT name FROM locations WHERE id = ?").get(c.location_id) as any)?.name as string | undefined) ?? null : null;
  const cands = candidatesFor(db, ctx.orgId);
  const rec = recommendAssignment("workload", { categoryId: c.category_id, departmentId: c.department_id, location: locName, priority: c.priority, sensitive: false, excludedUserIds: new Set(c.complainant_user_id ? [c.complainant_user_id] : []), previousAssigneeIds: new Set() }, cands);
  void org;
  return { ranked: rec.ranked.map((r) => ({ ...r, name: cands.find((x) => x.id === r.userId)?.name ?? "" })), sensitive: !!c.sensitive };
}

// ---------------------------------------------------------------- transitions

export function transitionComplaint(
  db: DB,
  ctx: AuthContext | null,
  complaintId: string,
  to: Status,
  opts: { comment?: string; expectedVersion?: number; actorOverride?: Actor; orgId?: string; viaApproval?: boolean; now?: number } = {},
): ComplaintRow {
  const now = opts.now ?? Date.now();
  if (!STATUSES.includes(to)) throw new HttpError(422, "Unknown status.");
  const orgId = ctx?.orgId ?? opts.orgId!;
  const c = ctx ? requireComplaint(db, ctx, complaintId) : getComplaintRow(db, orgId, complaintId);
  if (!c) throw new HttpError(404, "Complaint not found.");
  if (opts.expectedVersion != null && opts.expectedVersion !== c.version) throw new HttpError(409, "Someone else changed this complaint. Reload and try again.");
  const actor: Actor = opts.actorOverride ?? (ctx ? { kind: "user", perms: ctx.perms } : { kind: "system" });
  // Handlers may only move complaints that are assigned to them.
  if (ctx && actor.kind === "user" && !ctx.perms.has("complaint.view.all") && c.assignee_id !== ctx.userId) throw new HttpError(403, "Only the assigned handler can change this complaint.");
  const evidence = (db.prepare("SELECT COUNT(*) n FROM attachments WHERE complaint_id = ?").get(complaintId) as { n: number }).n;
  const rules = loadTransitions(db, orgId);
  const check = actor.kind === "system" ? { ok: true, reasons: [] as string[], rule: undefined } : checkTransition(rules, c.status, to, actor, { comment: opts.comment, evidenceCount: evidence, viaApproval: opts.viaApproval });
  if (!check.ok) throw new HttpError(422, check.reasons.join(" "), check.reasons);

  const cal = loadCalendar(db, orgId);
  const org = loadOrg(db, orgId);
  const patch: Record<string, unknown> = { status: to, updated_at: now };
  // SLA clock effects
  if (to === "Awaiting Complainant" && c.sla_paused_at == null && c.resolution_due_at != null) {
    patch.sla_paused_at = now;
    patch.sla_paused_remaining_minutes = pauseClock(c.resolution_due_at, now, cal);
  } else if (c.sla_paused_at != null && to !== "Awaiting Complainant") {
    patch.resolution_due_at = resumeClock(c.sla_paused_remaining_minutes ?? 0, now, cal);
    patch.sla_paused_at = null;
    patch.sla_paused_remaining_minutes = null;
  }
  if (to === "Acknowledged") patch.acknowledged_at = c.acknowledged_at ?? now;
  if (to === "Resolved") patch.resolved_at = now;
  if (to === "Closed") patch.closed_at = now;
  if (to === "Reopened") {
    patch.reopen_count = c.reopen_count + 1;
    patch.resolved_at = null;
    patch.closed_at = null;
    patch.resolution_due_at = addBusinessMinutes(now, Math.max(c.sla_total_minutes, 60), cal);
    patch.sla_paused_at = null;
    patch.sla_paused_remaining_minutes = null;
  }

  const sets = Object.keys(patch).map((k) => `${k} = ?`).join(", ");
  db.transaction(() => {
    const r = db.prepare(`UPDATE complaints SET ${sets}, version = version + 1 WHERE id = ? AND version = ?`).run(...Object.values(patch), complaintId, c.version);
    if (r.changes === 0) throw new HttpError(409, "Someone else changed this complaint. Reload and try again.");
    // What the complainant can see: staff comments on a status change are internal by default, so that
    // working notes never leak. Only the complainant's own reopen reason and the reason for a rejection are shared.
    const comment = opts.comment?.trim();
    const shareComment = !!comment && (actor.kind === "complainant" || to === "Rejected");
    const kind = actor.kind === "user" ? "user" : actor.kind === "complainant" ? "complainant" : "system";
    recordEvent(db, { orgId, complaintId, type: "status", actorKind: kind, actorId: ctx?.userId, actorName: ctx?.name, visibility: "public", body: shareComment ? comment : `Status changed to ${to}`, data: { from: c.status, to }, now });
    if (comment && !shareComment && actor.kind === "user") recordEvent(db, { orgId, complaintId, type: "comment", actorKind: "user", actorId: ctx?.userId, actorName: ctx?.name, visibility: "internal", body: comment, now });
    audit(db, { orgId, actorId: ctx?.userId ?? null, actorLabel: ctx?.email ?? actor.kind, action: "complaint.status", entityType: "complaint", entityId: complaintId, data: { from: c.status, to }, now });
  }).immediate();
  void org;

  const updated = getComplaintRow(db, orgId, complaintId)!;
  afterTransition(db, c, updated, to, opts.comment, now);
  return updated;
}

function afterTransition(db: DB, before: ComplaintRow, after: ComplaintRow, to: Status, comment: string | undefined, now: number): void {
  const org = loadOrg(db, after.org_id);
  const baseUrl = process.env.APP_URL ?? "http://localhost:3000";
  const external = after.contact_method === "email" && after.complainant_email && !after.is_anonymous;
  const vars = { name: after.complainant_name || "there", org: org.name, ref: after.ref, trackUrl: `${baseUrl}/track`, message: "" };
  if (to === "Closed" && external) queueEmail(db, { orgId: after.org_id, complaintId: after.id, to: after.complainant_email, template: "closure", key: "closed", now, vars });
  if (to === "Reopened") {
    for (const m of usersWithPermission(db, after.org_id, "complaint.assign")) {
      notifyUser(db, { orgId: after.org_id, userId: m.id, type: "reopened", title: `${after.ref} was reopened`, body: comment, link: `/complaints/${after.id}`, dedupeKey: `reopened:${after.id}:${after.reopen_count}`, now });
    }
    if (after.assignee_id) notifyUser(db, { orgId: after.org_id, userId: after.assignee_id, type: "reopened", title: `${after.ref} was reopened`, body: comment, link: `/complaints/${after.id}`, dedupeKey: `reopened-h:${after.id}:${after.reopen_count}`, now });
  }
  void before;
}

// ---------------------------------------------------------------- resolution & approval

export function proposeResolution(db: DB, ctx: AuthContext, complaintId: string, text: string, now = Date.now()): string {
  const c = requireComplaint(db, ctx, complaintId);
  const t = text.trim();
  if (t.length < 10) throw new HttpError(422, "Describe the proposed resolution (at least 10 characters).");
  if (c.status === "Pending Approval") throw new HttpError(409, "A resolution is already waiting for approval.");
  if (c.status === "Investigation in Progress") transitionComplaint(db, ctx, complaintId, "Resolution Proposed", { comment: "Resolution drafted.", now });
  else if (c.status !== "Resolution Proposed") throw new HttpError(409, `A resolution cannot be proposed while the complaint is "${c.status}".`);
  transitionComplaint(db, ctx, complaintId, "Pending Approval", { comment: "Resolution submitted for approval.", now });
  const id = newId();
  db.prepare("INSERT INTO approvals (id, org_id, complaint_id, proposed_resolution, requested_by, created_at) VALUES (?,?,?,?,?,?)").run(id, ctx.orgId, complaintId, t, ctx.userId, now);
  recordEvent(db, { orgId: ctx.orgId, complaintId, type: "resolution_proposed", actorKind: "user", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", body: t, now });
  audit(db, { orgId: ctx.orgId, actorId: ctx.userId, actorLabel: ctx.email, action: "approval.requested", entityType: "complaint", entityId: complaintId, now });
  for (const m of usersWithPermission(db, ctx.orgId, "complaint.approve")) {
    if (m.id !== ctx.userId) notifyUser(db, { orgId: ctx.orgId, userId: m.id, type: "approval", title: `Approval needed: ${c.ref}`, body: t.slice(0, 140), link: `/complaints/${complaintId}`, dedupeKey: `approval:${id}`, now });
  }
  return id;
}

export function decideApproval(db: DB, ctx: AuthContext, approvalId: string, approve: boolean, comment: string, now = Date.now()): void {
  if (!ctx.perms.has("complaint.approve")) throw new HttpError(403, "You do not have permission to approve resolutions.");
  const a = db.prepare("SELECT * FROM approvals WHERE id = ? AND org_id = ?").get(approvalId, ctx.orgId) as any;
  if (!a) throw new HttpError(404, "Approval request not found.");
  if (a.status !== "pending") throw new HttpError(409, "This request has already been decided.");
  if (a.requested_by === ctx.userId) throw new HttpError(403, "You cannot approve your own proposal. Ask another manager.");
  const c = requireComplaint(db, ctx, a.complaint_id);
  if (!approve && comment.trim().length < 3) throw new HttpError(422, "Explain why the resolution is rejected.");
  db.transaction(() => {
    db.prepare("UPDATE approvals SET status = ?, decided_by = ?, decision_comment = ?, decided_at = ? WHERE id = ? AND status = 'pending'").run(approve ? "approved" : "rejected", ctx.userId, comment.trim() || null, now, approvalId);
    if (approve) {
      transitionComplaint(db, ctx, c.id, "Resolved", { viaApproval: true, comment: "Resolution approved", now });
      db.prepare("UPDATE complaints SET resolution_summary = ? WHERE id = ?").run(a.proposed_resolution, c.id);
    } else {
      transitionComplaint(db, ctx, c.id, "Investigation in Progress", { comment: `Resolution rejected: ${comment.trim()}`, now });
    }
    recordEvent(db, { orgId: ctx.orgId, complaintId: c.id, type: approve ? "approval_approved" : "approval_rejected", actorKind: "user", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", body: comment.trim() || (approve ? "Approved" : "Rejected"), now });
    audit(db, { orgId: ctx.orgId, actorId: ctx.userId, actorLabel: ctx.email, action: approve ? "approval.approved" : "approval.rejected", entityType: "complaint", entityId: c.id, now });
  }).immediate();
  if (c.assignee_id && c.assignee_id !== ctx.userId) {
    notifyUser(db, { orgId: ctx.orgId, userId: c.assignee_id, type: "approval", title: `${c.ref} resolution ${approve ? "approved" : "rejected"}`, body: comment, link: `/complaints/${c.id}`, dedupeKey: `approval-result:${approvalId}`, now });
  }
  if (approve) {
    const org = loadOrg(db, ctx.orgId);
    const fresh = getComplaintRow(db, ctx.orgId, c.id)!;
    if (fresh.contact_method === "email" && fresh.complainant_email && !fresh.is_anonymous) {
      queueEmail(db, { orgId: ctx.orgId, complaintId: c.id, to: fresh.complainant_email, template: "resolution", key: "resolved", now, vars: { name: fresh.complainant_name || "there", org: org.name, ref: fresh.ref, trackUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/track`, message: a.proposed_resolution } });
    }
  }
}

// ---------------------------------------------------------------- notes, messages, tasks

export function addInternalNote(db: DB, ctx: AuthContext, complaintId: string, body: string, now = Date.now()): void {
  if (!ctx.perms.has("complaint.note.internal")) throw new HttpError(403, "You do not have permission to add internal notes.");
  const c = requireComplaint(db, ctx, complaintId);
  const text = body.trim();
  if (!text) throw new HttpError(422, "Write a note first.");
  if (text.length > 5000) throw new HttpError(422, "Note is too long.");
  recordEvent(db, { orgId: ctx.orgId, complaintId, type: "note", actorKind: "user", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", body: text, now });
  db.prepare("UPDATE complaints SET updated_at = ? WHERE id = ?").run(now, complaintId);
  // @mentions notify the named colleague (matched on email local part or full name).
  for (const m of text.matchAll(/@([\w.\-]+)/g)) {
    const u = db.prepare("SELECT id FROM users WHERE org_id = ? AND is_active = 1 AND (lower(email) LIKE ? OR lower(replace(name,' ','.')) = ?)").get(ctx.orgId, `${m[1].toLowerCase()}@%`, m[1].toLowerCase()) as { id: string } | undefined;
    if (u && u.id !== ctx.userId) notifyUser(db, { orgId: ctx.orgId, userId: u.id, type: "mention", title: `${ctx.name} mentioned you on ${c.ref}`, body: text.slice(0, 140), link: `/complaints/${complaintId}`, dedupeKey: `mention:${complaintId}:${now}:${u.id}`, now });
  }
}

export function sendMessage(db: DB, ctx: AuthContext, complaintId: string, body: string, kind: "update" | "request_info" = "update", now = Date.now()): void {
  if (!ctx.perms.has("complaint.message.external")) throw new HttpError(403, "You do not have permission to message complainants.");
  const c = requireComplaint(db, ctx, complaintId);
  if (!ctx.perms.has("complaint.view.all") && c.assignee_id !== ctx.userId) throw new HttpError(403, "Only the assigned handler can message the complainant.");
  const text = body.trim();
  if (!text) throw new HttpError(422, "Write a message first.");
  if (text.length > 5000) throw new HttpError(422, "Message is too long.");
  db.transaction(() => {
    recordEvent(db, { orgId: ctx.orgId, complaintId, type: kind === "request_info" ? "request_info" : "message", actorKind: "user", actorId: ctx.userId, actorName: ctx.name, visibility: "public", body: text, now });
    db.prepare("UPDATE complaints SET updated_at = ?, first_response_at = COALESCE(first_response_at, ?), version = version + 1 WHERE id = ?").run(now, now, complaintId);
    audit(db, { orgId: ctx.orgId, actorId: ctx.userId, actorLabel: ctx.email, action: "complaint.message_sent", entityType: "complaint", entityId: complaintId, now });
  }).immediate();
  if (c.contact_method === "email" && c.complainant_email && !c.is_anonymous) {
    const org = loadOrg(db, ctx.orgId);
    queueEmail(db, { orgId: ctx.orgId, complaintId, to: c.complainant_email, template: kind, key: String(now), now, vars: { name: c.complainant_name || "there", org: org.name, ref: c.ref, trackUrl: `${process.env.APP_URL ?? "http://localhost:3000"}/track`, message: text } });
  }
  if (kind === "request_info" && c.status === "Investigation in Progress") transitionComplaint(db, ctx, complaintId, "Awaiting Complainant", { comment: "Waiting for the complainant's reply.", now });
}

export function addTask(db: DB, ctx: AuthContext, complaintId: string, title: string, ownerId: string | null, dueAt: number | null, now = Date.now()): string {
  if (!ctx.perms.has("complaint.note.internal")) throw new HttpError(403, "You do not have permission to add tasks.");
  requireComplaint(db, ctx, complaintId);
  if (title.trim().length < 3) throw new HttpError(422, "Task title is too short.");
  if (ownerId && !db.prepare("SELECT 1 FROM users WHERE id = ? AND org_id = ? AND is_active = 1").get(ownerId, ctx.orgId)) throw new HttpError(422, "Unknown task owner.");
  const id = newId();
  db.prepare("INSERT INTO tasks (id, org_id, complaint_id, title, owner_id, due_at, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)").run(id, ctx.orgId, complaintId, title.trim(), ownerId, dueAt, ctx.userId, now);
  recordEvent(db, { orgId: ctx.orgId, complaintId, type: "task", actorKind: "user", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", body: `Task added: ${title.trim()}`, now });
  return id;
}

export function completeTask(db: DB, ctx: AuthContext, taskId: string, now = Date.now()): void {
  const t = db.prepare("SELECT * FROM tasks WHERE id = ? AND org_id = ?").get(taskId, ctx.orgId) as any;
  if (!t) throw new HttpError(404, "Task not found.");
  requireComplaint(db, ctx, t.complaint_id);
  if (!ctx.perms.has("complaint.note.internal")) throw new HttpError(403, "You do not have permission to update tasks.");
  db.prepare("UPDATE tasks SET done_at = COALESCE(done_at, ?) WHERE id = ?").run(now, taskId);
  recordEvent(db, { orgId: ctx.orgId, complaintId: t.complaint_id, type: "task_done", actorKind: "user", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", body: `Task completed: ${t.title}`, now });
}

export function linkRelated(db: DB, ctx: AuthContext, complaintId: string, otherId: string, now = Date.now()): void {
  if (!ctx.perms.has("complaint.note.internal")) throw new HttpError(403, "You do not have permission to link complaints.");
  const a = requireComplaint(db, ctx, complaintId);
  const b = requireComplaint(db, ctx, otherId);
  recordEvent(db, { orgId: ctx.orgId, complaintId, type: "linked", actorKind: "user", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", body: `Linked to ${b.ref}: ${b.title}`, data: { otherId }, now });
  recordEvent(db, { orgId: ctx.orgId, complaintId: otherId, type: "linked", actorKind: "user", actorId: ctx.userId, actorName: ctx.name, visibility: "internal", body: `Linked to ${a.ref}: ${a.title}`, data: { otherId: complaintId }, now });
}

// ---------------------------------------------------------------- listing

export interface ListFilters {
  q?: string;
  status?: string[];
  priority?: string;
  categoryId?: string;
  departmentId?: string;
  locationId?: string;
  assigneeId?: string;
  scope?: "mine" | "assigned" | "unassigned" | "escalated" | "awaiting_approval";
  from?: number;
  to?: number;
  sort?: "created_desc" | "created_asc" | "due_asc" | "priority_desc" | "updated_desc";
  page?: number;
  pageSize?: number;
}

const SORTS: Record<string, string> = {
  created_desc: "c.created_at DESC",
  created_asc: "c.created_at ASC",
  due_asc: "(c.resolution_due_at IS NULL), c.resolution_due_at ASC",
  priority_desc: "CASE c.priority WHEN 'Critical' THEN 0 WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 ELSE 3 END, c.created_at ASC",
  updated_desc: "c.updated_at DESC",
};

export function buildFilter(ctx: AuthContext, f: ListFilters): { where: string; params: unknown[] } {
  const scope = scopeSql(ctx);
  const w = [scope.sql];
  const p: unknown[] = [...scope.params];
  if (f.q?.trim()) {
    const like = `%${f.q.trim().replace(/[\\%_]/g, (m) => "\\" + m)}%`;
    w.push("(c.ref LIKE ? ESCAPE '\\' OR c.title LIKE ? ESCAPE '\\' OR c.description LIKE ? ESCAPE '\\' OR c.related_ref LIKE ? ESCAPE '\\')");
    p.push(like, like, like, like);
  }
  if (f.status?.length) { w.push(`c.status IN (${f.status.map(() => "?").join(",")})`); p.push(...f.status); }
  if (f.priority) { w.push("c.priority = ?"); p.push(f.priority); }
  if (f.categoryId) { w.push("c.category_id = ?"); p.push(f.categoryId); }
  if (f.departmentId) { w.push("c.department_id = ?"); p.push(f.departmentId); }
  if (f.locationId) { w.push("c.location_id = ?"); p.push(f.locationId); }
  if (f.assigneeId) { w.push("c.assignee_id = ?"); p.push(f.assigneeId); }
  if (f.from) { w.push("c.created_at >= ?"); p.push(f.from); }
  if (f.to) { w.push("c.created_at < ?"); p.push(f.to); }
  if (f.scope === "mine") { w.push("c.complainant_user_id = ?"); p.push(ctx.userId); }
  if (f.scope === "assigned") { w.push("c.assignee_id = ?"); p.push(ctx.userId); }
  if (f.scope === "unassigned") { w.push(`c.assignee_id IS NULL AND c.status IN (${OPEN_STATUSES.map(() => "?").join(",")})`); p.push(...OPEN_STATUSES); }
  if (f.scope === "awaiting_approval") { w.push("c.status = 'Pending Approval'"); }
  if (f.scope === "escalated") { w.push("EXISTS (SELECT 1 FROM escalations e WHERE e.complaint_id = c.id AND e.acknowledged_at IS NULL)"); }
  return { where: w.join(" AND "), params: p };
}

export interface ListItem extends ComplaintRow {
  category_name: string | null; department_name: string | null; assignee_name: string | null; location_name: string | null;
  sla: SlaSnapshot;
}

export function listComplaints(db: DB, ctx: AuthContext, f: ListFilters = {}, now = Date.now()): { items: ListItem[]; total: number; page: number; pageSize: number } {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100);
  const page = Math.max(f.page ?? 1, 1);
  const { where, params } = buildFilter(ctx, f);
  const total = (db.prepare(`SELECT COUNT(*) n FROM complaints c WHERE ${where}`).get(...params) as { n: number }).n;
  const rows = db.prepare(
    `SELECT c.*, cat.name AS category_name, d.name AS department_name, u.name AS assignee_name, l.name AS location_name
     FROM complaints c
     LEFT JOIN categories cat ON cat.id = c.category_id LEFT JOIN departments d ON d.id = c.department_id
     LEFT JOIN users u ON u.id = c.assignee_id LEFT JOIN locations l ON l.id = c.location_id
     WHERE ${where} ORDER BY ${SORTS[f.sort ?? "created_desc"] ?? SORTS.created_desc} LIMIT ? OFFSET ?`,
  ).all(...params, pageSize, (page - 1) * pageSize) as any[];
  const cal = loadCalendar(db, ctx.orgId);
  const org = loadOrg(db, ctx.orgId);
  const canPii = ctx.perms.has("complainant.pii.view");
  const items = rows.map((r) => {
    const item = { ...r, sla: slaFor(db, r, now, cal, org.atRiskPct) } as ListItem;
    if (!canPii) { item.complainant_email = null; item.complainant_phone = null; item.complainant_name = item.complainant_user_id === ctx.userId ? item.complainant_name : null; }
    return item;
  });
  return { items, total, page, pageSize };
}

// ---------------------------------------------------------------- detail

export function getComplaintDetail(db: DB, ctx: AuthContext, id: string, now = Date.now()) {
  const c = requireComplaint(db, ctx, id);
  const isStaff = ctx.perms.has("complaint.view.all") || ctx.perms.has("complaint.view.assigned");
  const canPii = ctx.perms.has("complainant.pii.view");
  const org = loadOrg(db, ctx.orgId);
  const events = db.prepare(`SELECT * FROM complaint_events WHERE complaint_id = ? ${isStaff ? "" : "AND visibility = 'public'"} ORDER BY created_at, rowid`).all(id) as any[];
  const attachments = db.prepare(`SELECT id, filename, mime, size, visibility, uploader_kind, created_at FROM attachments WHERE complaint_id = ? ${isStaff ? "" : "AND visibility = 'public'"} ORDER BY created_at`).all(id) as any[];
  const detail: any = {
    complaint: { ...c, access_code_hash: undefined, complainant_email: canPii ? c.complainant_email : null, complainant_phone: canPii ? c.complainant_phone : null, complainant_name: canPii || c.complainant_user_id === ctx.userId ? c.complainant_name : null },
    sla: slaFor(db, c, now, undefined, org.atRiskPct),
    events, attachments,
    category: c.category_id ? db.prepare("SELECT id, name FROM categories WHERE id = ?").get(c.category_id) : null,
    department: c.department_id ? db.prepare("SELECT id, name FROM departments WHERE id = ?").get(c.department_id) : null,
    location: c.location_id ? db.prepare("SELECT id, name FROM locations WHERE id = ?").get(c.location_id) : null,
    assignee: c.assignee_id ? db.prepare("SELECT id, name FROM users WHERE id = ?").get(c.assignee_id) : null,
  };
  if (isStaff) {
    detail.tasks = db.prepare("SELECT t.*, u.name AS owner_name FROM tasks t LEFT JOIN users u ON u.id = t.owner_id WHERE t.complaint_id = ? ORDER BY t.created_at").all(id);
    detail.approvals = db.prepare("SELECT a.*, r.name AS requested_by_name, d.name AS decided_by_name FROM approvals a JOIN users r ON r.id = a.requested_by LEFT JOIN users d ON d.id = a.decided_by WHERE a.complaint_id = ? ORDER BY a.created_at").all(id);
    detail.assignments = db.prepare("SELECT a.*, t.name AS to_name, f.name AS from_name, b.name AS by_name FROM assignments a LEFT JOIN users t ON t.id = a.to_user_id LEFT JOIN users f ON f.id = a.from_user_id LEFT JOIN users b ON b.id = a.by_user_id WHERE a.complaint_id = ? ORDER BY a.created_at").all(id);
    detail.escalations = db.prepare("SELECT * FROM escalations WHERE complaint_id = ? ORDER BY created_at").all(id);
    detail.related = db.prepare("SELECT id, ref, title, status FROM complaints WHERE org_id = ? AND id != ? AND (related_ref = ? OR ref = ?)").all(ctx.orgId, id, c.ref, c.related_ref ?? "");
    detail.survey = db.prepare("SELECT rating, comment FROM surveys WHERE complaint_id = ?").get(id) ?? null;
  }
  const rules = loadTransitions(db, ctx.orgId);
  const evidence = attachments.length;
  detail.allowedTransitions = rules
    .filter((r) => r.from === c.status && r.enabled)
    .map((r) => ({ to: r.to, requiresComment: r.requiresComment, check: checkTransition(rules, c.status, r.to, { kind: "user", perms: ctx.perms }, { comment: "ok-ok", evidenceCount: evidence, viaApproval: false }) }))
    .filter((r) => r.check.ok || (r.check.reasons.length === 1 && r.check.reasons[0].includes("approval decision")))
    .filter((r) => r.to !== "Resolved")
    .map((r) => ({ to: r.to, requiresComment: r.requiresComment }));
  if (!ctx.perms.has("complaint.view.all") && c.assignee_id !== ctx.userId) detail.allowedTransitions = [];
  return detail;
}

export function minutesSince(db: DB, orgId: string, from: number, to: number): number {
  return businessMinutesBetween(from, to, loadCalendar(db, orgId));
}

// ---------------------------------------------------------------- bulk actions

export interface BulkResult { id: string; ref?: string; ok: boolean; error?: string }

/**
 * Apply one action to several complaints. Each complaint goes through the exact same checks as a single
 * action (permissions, workflow rules, conflicts of interest), so a bulk run can never do more than a person could one by one.
 */
export function bulkAction(
  db: DB,
  ctx: AuthContext,
  input: { ids: string[]; action: "assign" | "transition"; userId?: string; to?: Status; comment?: string; confirm: boolean },
  now = Date.now(),
): BulkResult[] {
  if (!input.confirm) throw new HttpError(422, "Confirm the bulk action before running it.");
  const ids = [...new Set(input.ids)];
  if (ids.length === 0) throw new HttpError(422, "Select at least one complaint.");
  if (ids.length > 50) throw new HttpError(422, "Bulk actions are limited to 50 complaints at a time.");
  return ids.map((id) => {
    const row = getComplaintRow(db, ctx.orgId, id);
    try {
      if (input.action === "assign") {
        if (!input.userId) throw new HttpError(422, "Choose who to assign to.");
        assignComplaint(db, ctx, id, input.userId, input.comment ?? "Bulk assignment", now);
      } else {
        if (!input.to) throw new HttpError(422, "Choose a status.");
        transitionComplaint(db, ctx, id, input.to, { comment: input.comment, now });
      }
      return { id, ref: row?.ref, ok: true };
    } catch (e) {
      return { id, ref: row?.ref, ok: false, error: e instanceof HttpError ? e.message : "Failed." };
    }
  });
}
