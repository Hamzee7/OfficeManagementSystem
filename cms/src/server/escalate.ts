import { type DB, newId } from "./db";
import { audit } from "./audit";
import { loadCalendar, loadOrg } from "./org";
import { notifyUser, queueEmail, usersWithPermission } from "./notify";
import { recordEvent, slaFor, type ComplaintRow } from "./complaints";
import { evaluateEscalations } from "@/lib/escalation";
import { businessMinutesBetween } from "@/lib/calendar";
import { OPEN_STATUSES } from "@/lib/workflow";

export interface SweepResult { checked: number; created: number }

/**
 * Evaluate SLA and escalation rules for every open complaint. Safe to run as often as you like:
 * each (complaint, rule, level) escalation is stored once, so repeats do nothing.
 * Runs in the background worker; the web UI does not need to be open.
 */
export function runSlaSweep(db: DB, now = Date.now(), orgId?: string): SweepResult {
  const orgs = (orgId ? [{ id: orgId }] : db.prepare("SELECT id FROM organizations").all()) as { id: string }[];
  let checked = 0, created = 0;
  for (const { id: oid } of orgs) {
    const org = loadOrg(db, oid);
    const cal = loadCalendar(db, oid);
    const rows = db.prepare(`SELECT * FROM complaints WHERE org_id = ? AND status IN (${OPEN_STATUSES.map(() => "?").join(",")})`).all(oid, ...OPEN_STATUSES) as ComplaintRow[];
    for (const c of rows) {
      checked++;
      const sla = slaFor(db, c, now, cal, org.atRiskPct);
      const hits = evaluateEscalations(
        { priority: c.priority, status: c.status, assigneeId: c.assignee_id, sla, firstResponseAt: c.first_response_at, firstResponseDue: c.first_response_due_at, minutesSinceCreated: businessMinutesBetween(c.created_at, now, cal), reopenCount: c.reopen_count },
        now, org.escalation,
      );
      for (const h of hits) {
        const ins = db.prepare("INSERT INTO escalations (id, org_id, complaint_id, rule_key, level, message, created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT (complaint_id, rule_key, level) DO NOTHING").run(newId(), oid, c.id, h.ruleKey, h.level, h.message, now);
        if (ins.changes === 0) continue;
        created++;
        recordEvent(db, { orgId: oid, complaintId: c.id, type: "escalation", actorKind: "system", visibility: "internal", body: `Escalated (level ${h.level}): ${h.message}`, data: { rule: h.ruleKey }, now });
        audit(db, { orgId: oid, actorLabel: "system", action: "complaint.escalated", entityType: "complaint", entityId: c.id, data: { rule: h.ruleKey, level: h.level }, now });
        const targets = new Map<string, { email: string }>();
        if (h.notify.includes("assignee") && c.assignee_id) {
          const u = db.prepare("SELECT id, email FROM users WHERE id = ? AND is_active = 1").get(c.assignee_id) as any;
          if (u) targets.set(u.id, u);
        }
        if (h.notify.includes("manager")) for (const m of usersWithPermission(db, oid, "complaint.escalation.manage")) targets.set(m.id, m);
        if (h.notify.includes("admin")) for (const m of usersWithPermission(db, oid, "org.manage")) targets.set(m.id, m);
        for (const [uid, u] of targets) {
          notifyUser(db, { orgId: oid, userId: uid, type: "escalation", title: `${c.ref}: ${h.message}`, body: c.title, link: `/complaints/${c.id}`, dedupeKey: `esc:${c.id}:${h.ruleKey}:${h.level}`, now });
          queueEmail(db, { orgId: oid, complaintId: c.id, to: u.email, template: h.ruleKey === "deadline_approaching" ? "sla_warning" : "escalation", key: `${h.ruleKey}:${h.level}`, now, vars: { ref: c.ref, title: c.title, message: h.message, link: `${process.env.APP_URL ?? "http://localhost:3000"}/complaints/${c.id}` } });
        }
      }
    }
  }
  return { checked, created };
}

export function acknowledgeEscalation(db: DB, orgId: string, userId: string, escalationId: string, now = Date.now()): void {
  const r = db.prepare("UPDATE escalations SET acknowledged_by = ?, acknowledged_at = ? WHERE id = ? AND org_id = ? AND acknowledged_at IS NULL").run(userId, now, escalationId, orgId);
  if (r.changes) audit(db, { orgId, actorId: userId, action: "escalation.acknowledged", entityType: "escalation", entityId: escalationId, now });
}

/**
 * Data-retention: remove personal data from complaints closed longer ago than the organization's
 * retention period. The case record, its history and statistics stay; names and contact details go.
 */
export function applyRetention(db: DB, orgId: string, now = Date.now()): number {
  const org = loadOrg(db, orgId);
  const cutoff = now - org.retentionDays * 86_400_000;
  const r = db.prepare(
    `UPDATE complaints SET complainant_name = NULL, complainant_email = NULL, complainant_phone = NULL, contact_method = 'none'
     WHERE org_id = ? AND closed_at IS NOT NULL AND closed_at < ? AND (complainant_name IS NOT NULL OR complainant_email IS NOT NULL OR complainant_phone IS NOT NULL)`,
  ).run(orgId, cutoff);
  if (r.changes) audit(db, { orgId, actorLabel: "system", action: "retention.applied", data: { scrubbed: r.changes }, now });
  return r.changes;
}
