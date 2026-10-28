import { type DB, newId } from "./db";
import { HttpError, hashPassword, passwordProblem, requirePerm, revokeUserSessions, type AuthContext } from "./auth";
import { audit } from "./audit";
import { createOrganization } from "./org";
import { PERMISSIONS } from "@/lib/permissions";
import { parseHHMM } from "@/lib/calendar";
import { STATUSES } from "@/lib/workflow";

// ------------------------------------------------------------------ users

export function createUser(db: DB, ctx: AuthContext, i: { email: string; name: string; password: string; roleId: string; departmentId?: string | null; location?: string | null; skills?: string[] }, now = Date.now()): string {
  requirePerm(ctx, "users.manage");
  const email = i.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(422, "That email address does not look valid.");
  if (i.name.trim().length < 2) throw new HttpError(422, "Enter the person's name.");
  const pw = passwordProblem(i.password);
  if (pw) throw new HttpError(422, pw);
  const role = db.prepare("SELECT id, key FROM roles WHERE id = ? AND org_id = ?").get(i.roleId, ctx.orgId) as { id: string; key: string } | undefined;
  if (!role) throw new HttpError(422, "Unknown role.");
  if (role.key === "super_admin" && !ctx.perms.has("platform.manage")) throw new HttpError(403, "Only a platform administrator can create another platform administrator.");
  if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) throw new HttpError(409, "A user with that email already exists.");
  if (i.departmentId && !db.prepare("SELECT 1 FROM departments WHERE id = ? AND org_id = ?").get(i.departmentId, ctx.orgId)) throw new HttpError(422, "Unknown department.");
  const id = newId();
  db.prepare("INSERT INTO users (id, org_id, email, name, password_hash, role_id, department_id, location, skills, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
    id, ctx.orgId, email, i.name.trim(), hashPassword(i.password), role.id, i.departmentId ?? null, i.location ?? null, JSON.stringify(i.skills ?? []), now, now,
  );
  audit(db, { orgId: ctx.orgId, actorId: ctx.userId, actorLabel: ctx.email, action: "user.created", entityType: "user", entityId: id, data: { role: role.key }, now });
  return id;
}

export function updateUser(db: DB, ctx: AuthContext, userId: string, p: { roleId?: string; departmentId?: string | null; location?: string | null; available?: boolean; isActive?: boolean; skills?: string[] }, now = Date.now()): void {
  requirePerm(ctx, "users.manage");
  const u = db.prepare("SELECT * FROM users WHERE id = ? AND org_id = ?").get(userId, ctx.orgId) as any;
  if (!u) throw new HttpError(404, "User not found.");
  if (userId === ctx.userId && (p.isActive === false || p.roleId)) throw new HttpError(422, "You cannot deactivate yourself or change your own role.");
  if (p.roleId) {
    const role = db.prepare("SELECT key FROM roles WHERE id = ? AND org_id = ?").get(p.roleId, ctx.orgId) as { key: string } | undefined;
    if (!role) throw new HttpError(422, "Unknown role.");
    if (role.key === "super_admin" && !ctx.perms.has("platform.manage")) throw new HttpError(403, "Only a platform administrator can grant that role.");
  }
  db.prepare("UPDATE users SET role_id = COALESCE(?, role_id), department_id = CASE WHEN ? THEN ? ELSE department_id END, location = CASE WHEN ? THEN ? ELSE location END, available = COALESCE(?, available), is_active = COALESCE(?, is_active), skills = COALESCE(?, skills), updated_at = ? WHERE id = ?").run(
    p.roleId ?? null, +(p.departmentId !== undefined), p.departmentId ?? null, +(p.location !== undefined), p.location ?? null,
    p.available == null ? null : +p.available, p.isActive == null ? null : +p.isActive, p.skills ? JSON.stringify(p.skills) : null, now, userId,
  );
  if (p.isActive === false || p.roleId) revokeUserSessions(db, userId); // access changes take effect immediately
  audit(db, { orgId: ctx.orgId, actorId: ctx.userId, actorLabel: ctx.email, action: p.isActive === false ? "user.deactivated" : "user.updated", entityType: "user", entityId: userId, data: { fields: Object.keys(p) }, now });
}

export function changeOwnPassword(db: DB, ctx: AuthContext, current: string, next: string, verify: (pw: string, hash: string) => boolean): void {
  const u = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(ctx.userId) as { password_hash: string };
  if (!verify(current, u.password_hash)) throw new HttpError(403, "Current password is incorrect.");
  const p = passwordProblem(next);
  if (p) throw new HttpError(422, p);
  db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hashPassword(next), Date.now(), ctx.userId);
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(ctx.userId, ctx.sessionId);
  audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: "user.password_changed" });
}

// ------------------------------------------------------------------ roles

export function saveRole(db: DB, ctx: AuthContext, i: { id?: string; name: string; description?: string; permissions: string[] }, now = Date.now()): string {
  requirePerm(ctx, "roles.manage");
  const unknown = i.permissions.filter((p) => !(PERMISSIONS as readonly string[]).includes(p));
  if (unknown.length) throw new HttpError(422, `Unknown permissions: ${unknown.join(", ")}`);
  if (i.permissions.includes("platform.manage") && !ctx.perms.has("platform.manage")) throw new HttpError(403, "Only a platform administrator can grant platform permissions.");
  if (i.name.trim().length < 3) throw new HttpError(422, "Role name is too short.");
  let id = i.id;
  db.transaction(() => {
    if (id) {
      const r = db.prepare("SELECT is_system FROM roles WHERE id = ? AND org_id = ?").get(id, ctx.orgId) as { is_system: number } | undefined;
      if (!r) throw new HttpError(404, "Role not found.");
      if (r.is_system) throw new HttpError(422, "Built-in roles cannot be edited. Create a custom role instead.");
      db.prepare("UPDATE roles SET name = ?, description = ? WHERE id = ?").run(i.name.trim(), i.description ?? "", id);
      db.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(id);
    } else {
      id = newId();
      const key = "custom_" + i.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30) + "_" + id.slice(0, 4);
      db.prepare("INSERT INTO roles (id, org_id, key, name, description, is_system, created_at) VALUES (?,?,?,?,?,0,?)").run(id, ctx.orgId, key, i.name.trim(), i.description ?? "", now);
    }
    const ins = db.prepare("INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)");
    for (const p of new Set(i.permissions)) ins.run(id, p);
    audit(db, { orgId: ctx.orgId, actorId: ctx.userId, actorLabel: ctx.email, action: "role.saved", entityType: "role", entityId: id!, data: { permissions: i.permissions.length }, now });
  })();
  // Everyone holding the role gets the new permissions on their next request (permissions are read per request).
  return id!;
}

// ------------------------------------------------------------------ org structure

export function saveDepartment(db: DB, ctx: AuthContext, i: { id?: string; name: string; managerId?: string | null; active?: boolean }): string {
  requirePerm(ctx, "departments.manage");
  if (i.name.trim().length < 2) throw new HttpError(422, "Department name is too short.");
  if (i.managerId && !db.prepare("SELECT 1 FROM users WHERE id = ? AND org_id = ?").get(i.managerId, ctx.orgId)) throw new HttpError(422, "Unknown manager.");
  const id = i.id ?? newId();
  try {
    if (i.id) {
      const r = db.prepare("UPDATE departments SET name = ?, manager_id = ?, active = COALESCE(?, active) WHERE id = ? AND org_id = ?").run(i.name.trim(), i.managerId ?? null, i.active == null ? null : +i.active, id, ctx.orgId);
      if (!r.changes) throw new HttpError(404, "Department not found.");
    } else db.prepare("INSERT INTO departments (id, org_id, name, manager_id, created_at) VALUES (?,?,?,?,?)").run(id, ctx.orgId, i.name.trim(), i.managerId ?? null, Date.now());
  } catch (e: any) {
    if (String(e.message).includes("UNIQUE")) throw new HttpError(409, "A department with that name already exists.");
    throw e;
  }
  audit(db, { orgId: ctx.orgId, actorId: ctx.userId, actorLabel: ctx.email, action: "department.saved", entityType: "department", entityId: id });
  return id;
}

export function saveLocation(db: DB, ctx: AuthContext, name: string): string {
  requirePerm(ctx, "departments.manage");
  if (name.trim().length < 2) throw new HttpError(422, "Location name is too short.");
  const id = newId();
  try { db.prepare("INSERT INTO locations (id, org_id, name) VALUES (?,?,?)").run(id, ctx.orgId, name.trim()); }
  catch (e: any) { if (String(e.message).includes("UNIQUE")) throw new HttpError(409, "That location already exists."); throw e; }
  audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: "location.created", entityType: "location", entityId: id });
  return id;
}

export function saveCategory(db: DB, ctx: AuthContext, i: { id?: string; name: string; departmentId?: string | null; sensitive?: boolean; defaultPriority?: string; ackMinutes: number; firstResponseMinutes: number; resolutionMinutes: number; keywords?: string[]; active?: boolean }): string {
  requirePerm(ctx, "categories.manage");
  if (i.name.trim().length < 2) throw new HttpError(422, "Category name is too short.");
  if (![i.ackMinutes, i.firstResponseMinutes, i.resolutionMinutes].every((n) => Number.isInteger(n) && n >= 1 && n <= 60 * 24 * 90)) throw new HttpError(422, "SLA targets must be whole business minutes between 1 and 129,600.");
  if (!(i.ackMinutes <= i.firstResponseMinutes && i.firstResponseMinutes <= i.resolutionMinutes)) throw new HttpError(422, "Targets must increase: acknowledgment, then first response, then resolution.");
  if (i.defaultPriority && !["Low", "Medium", "High", "Critical"].includes(i.defaultPriority)) throw new HttpError(422, "Unknown priority.");
  if (i.departmentId && !db.prepare("SELECT 1 FROM departments WHERE id = ? AND org_id = ?").get(i.departmentId, ctx.orgId)) throw new HttpError(422, "Unknown department.");
  const id = i.id ?? newId();
  try {
    if (i.id) {
      const r = db.prepare("UPDATE categories SET name=?, department_id=?, sensitive=?, default_priority=?, ack_minutes=?, first_response_minutes=?, resolution_minutes=?, keywords=?, active=? WHERE id=? AND org_id=?").run(
        i.name.trim(), i.departmentId ?? null, +!!i.sensitive, i.defaultPriority ?? "Medium", i.ackMinutes, i.firstResponseMinutes, i.resolutionMinutes, JSON.stringify(i.keywords ?? []), i.active === false ? 0 : 1, id, ctx.orgId,
      );
      if (!r.changes) throw new HttpError(404, "Category not found.");
    } else db.prepare("INSERT INTO categories (id, org_id, name, department_id, sensitive, default_priority, ack_minutes, first_response_minutes, resolution_minutes, keywords) VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      id, ctx.orgId, i.name.trim(), i.departmentId ?? null, +!!i.sensitive, i.defaultPriority ?? "Medium", i.ackMinutes, i.firstResponseMinutes, i.resolutionMinutes, JSON.stringify(i.keywords ?? []),
    );
  } catch (e: any) {
    if (String(e.message).includes("UNIQUE")) throw new HttpError(409, "A category with that name already exists.");
    throw e;
  }
  audit(db, { orgId: ctx.orgId, actorId: ctx.userId, actorLabel: ctx.email, action: "category.saved", entityType: "category", entityId: id });
  return id;
}

export function saveOrgSettings(db: DB, ctx: AuthContext, i: { name?: string; timezone?: string; workDays?: number[]; workStart?: string; workEnd?: string; allowAnonymous?: boolean; aiEnabled?: boolean; assignmentStrategy?: string; atRiskPct?: number; criticalUnassignedMinutes?: number; reopenThreshold?: number; retentionDays?: number }): void {
  requirePerm(ctx, "org.manage");
  if (i.timezone) { try { new Intl.DateTimeFormat("en", { timeZone: i.timezone }); } catch { throw new HttpError(422, "Unknown time zone. Use a name like Asia/Karachi."); } }
  if (i.workStart) parseHHMM(i.workStart);
  if (i.workEnd) parseHHMM(i.workEnd);
  const o = db.prepare("SELECT work_start, work_end FROM organizations WHERE id = ?").get(ctx.orgId) as any;
  if (parseHHMM(i.workEnd ?? o.work_end) <= parseHHMM(i.workStart ?? o.work_start)) throw new HttpError(422, "Closing time must be after opening time.");
  if (i.workDays && (!i.workDays.length || i.workDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) throw new HttpError(422, "Choose at least one working day.");
  if (i.assignmentStrategy && !["manual", "round_robin", "workload", "rules"].includes(i.assignmentStrategy)) throw new HttpError(422, "Unknown assignment strategy.");
  if (i.atRiskPct != null && (i.atRiskPct < 10 || i.atRiskPct > 99)) throw new HttpError(422, "At-risk threshold must be between 10 and 99.");
  db.prepare(`UPDATE organizations SET name=COALESCE(?,name), timezone=COALESCE(?,timezone), work_days=COALESCE(?,work_days), work_start=COALESCE(?,work_start), work_end=COALESCE(?,work_end),
    allow_anonymous=COALESCE(?,allow_anonymous), ai_enabled=COALESCE(?,ai_enabled), assignment_strategy=COALESCE(?,assignment_strategy), at_risk_pct=COALESCE(?,at_risk_pct),
    critical_unassigned_minutes=COALESCE(?,critical_unassigned_minutes), reopen_threshold=COALESCE(?,reopen_threshold), retention_days=COALESCE(?,retention_days) WHERE id=?`).run(
    i.name ?? null, i.timezone ?? null, i.workDays ? JSON.stringify(i.workDays) : null, i.workStart ?? null, i.workEnd ?? null,
    i.allowAnonymous == null ? null : +i.allowAnonymous, i.aiEnabled == null ? null : +i.aiEnabled, i.assignmentStrategy ?? null, i.atRiskPct ?? null,
    i.criticalUnassignedMinutes ?? null, i.reopenThreshold ?? null, i.retentionDays ?? null, ctx.orgId,
  );
  audit(db, { orgId: ctx.orgId, actorId: ctx.userId, actorLabel: ctx.email, action: "org.settings_changed", entityType: "organization", entityId: ctx.orgId, data: { fields: Object.keys(i) } });
}

export function addHoliday(db: DB, ctx: AuthContext, date: string, name: string): void {
  requirePerm(ctx, "org.manage");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new HttpError(422, "Use the date format YYYY-MM-DD.");
  db.prepare("INSERT INTO holidays (id, org_id, date, name) VALUES (?,?,?,?) ON CONFLICT (org_id, date) DO UPDATE SET name = excluded.name").run(newId(), ctx.orgId, date, name.trim() || "Holiday");
  audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: "holiday.saved", data: { date } });
}
export function removeHoliday(db: DB, ctx: AuthContext, id: string): void {
  requirePerm(ctx, "org.manage");
  db.prepare("DELETE FROM holidays WHERE id = ? AND org_id = ?").run(id, ctx.orgId);
  audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: "holiday.removed", entityId: id });
}

export function saveTransition(db: DB, ctx: AuthContext, i: { from: string; to: string; requiresComment: boolean; requiresEvidence: boolean; enabled: boolean }): void {
  requirePerm(ctx, "workflow.manage");
  if (!(STATUSES as readonly string[]).includes(i.from) || !(STATUSES as readonly string[]).includes(i.to)) throw new HttpError(422, "Unknown status.");
  const r = db.prepare("UPDATE workflow_transitions SET requires_comment = ?, requires_evidence = ?, enabled = ? WHERE org_id = ? AND from_status = ? AND to_status = ?").run(+i.requiresComment, +i.requiresEvidence, +i.enabled, ctx.orgId, i.from, i.to);
  if (!r.changes) throw new HttpError(404, "That transition does not exist.");
  // The approval gate on Pending Approval -> Resolved and who may close are security controls, not configuration.
  if (i.from === "Pending Approval" && i.to === "Resolved" && !i.enabled) throw new HttpError(422, "The approval step cannot be disabled.");
  audit(db, { orgId: ctx.orgId, actorId: ctx.userId, actorLabel: ctx.email, action: "workflow.changed", data: i });
}

export function saveTemplate(db: DB, ctx: AuthContext, key: string, subject: string, body: string): void {
  requirePerm(ctx, "org.manage");
  if (!subject.trim() || !body.trim()) throw new HttpError(422, "Subject and body are required.");
  db.prepare("INSERT INTO message_templates (org_id, key, subject, body) VALUES (?,?,?,?) ON CONFLICT (org_id, key) DO UPDATE SET subject = excluded.subject, body = excluded.body").run(ctx.orgId, key, subject, body);
  audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: "template.saved", data: { key } });
}

export function createOrganizationAsPlatformAdmin(db: DB, ctx: AuthContext, i: { name: string; slug: string; timezone?: string }) {
  requirePerm(ctx, "platform.manage");
  if (!/^[a-z0-9-]{2,40}$/.test(i.slug)) throw new HttpError(422, "Slug can use lower-case letters, numbers and hyphens.");
  if (db.prepare("SELECT 1 FROM organizations WHERE slug = ?").get(i.slug)) throw new HttpError(409, "That slug is taken.");
  return createOrganization(db, { ...i, actorId: ctx.userId });
}

// ------------------------------------------------------------------ knowledge base

export function saveArticle(db: DB, ctx: AuthContext, i: { id?: string; title: string; body: string; tags?: string[]; published?: boolean }): string {
  requirePerm(ctx, "kb.manage");
  if (i.title.trim().length < 3 || i.body.trim().length < 10) throw new HttpError(422, "Add a title and some content.");
  const now = Date.now();
  const id = i.id ?? newId();
  if (i.id) {
    const r = db.prepare("UPDATE kb_articles SET title=?, body=?, tags=?, published=?, updated_at=? WHERE id=? AND org_id=?").run(i.title.trim(), i.body, JSON.stringify(i.tags ?? []), i.published === false ? 0 : 1, now, id, ctx.orgId);
    if (!r.changes) throw new HttpError(404, "Article not found.");
  } else db.prepare("INSERT INTO kb_articles (id, org_id, title, body, tags, published, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id, ctx.orgId, i.title.trim(), i.body, JSON.stringify(i.tags ?? []), i.published === false ? 0 : 1, ctx.userId, now, now);
  audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: "kb.saved", entityType: "kb_article", entityId: id });
  return id;
}
