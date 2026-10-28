import { type DB, newId } from "./db";
import { audit } from "./audit";
import { SYSTEM_ROLES } from "@/lib/permissions";
import { DEFAULT_TRANSITIONS, type TransitionRule } from "@/lib/workflow";
import { parseHHMM, type BusinessCalendar } from "@/lib/calendar";
import type { EscalationSettings } from "@/lib/escalation";

export interface OrgSettings {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  allowAnonymous: boolean;
  aiEnabled: boolean;
  assignmentStrategy: "manual" | "round_robin" | "workload" | "rules";
  atRiskPct: number;
  refPrefix: string;
  retentionDays: number;
  brandColor: string;
  pillButtons: boolean;
  hasLogo: boolean;
  requireMfa: boolean;
  escalation: EscalationSettings;
}

export function loadOrg(db: DB, orgId: string): OrgSettings {
  const o = db.prepare("SELECT * FROM organizations WHERE id = ?").get(orgId) as any;
  if (!o) throw new Error("Organization not found");
  return {
    id: o.id, name: o.name, slug: o.slug, timezone: o.timezone,
    allowAnonymous: !!o.allow_anonymous, aiEnabled: !!o.ai_enabled,
    assignmentStrategy: o.assignment_strategy, atRiskPct: o.at_risk_pct, refPrefix: o.ref_prefix, retentionDays: o.retention_days, brandColor: o.brand_color, pillButtons: !!o.pill_buttons, hasLogo: !!o.logo_key, requireMfa: !!o.require_mfa,
    escalation: { criticalUnassignedMinutes: o.critical_unassigned_minutes, unresolvedBreachMultiple: 2, reopenThreshold: o.reopen_threshold },
  };
}

export function loadCalendar(db: DB, orgId: string): BusinessCalendar {
  const o = db.prepare("SELECT timezone, work_days, work_start, work_end FROM organizations WHERE id = ?").get(orgId) as any;
  const holidays = new Set((db.prepare("SELECT date FROM holidays WHERE org_id = ?").all(orgId) as any[]).map((r) => r.date as string));
  return { timezone: o.timezone, workDays: JSON.parse(o.work_days), startMinute: parseHHMM(o.work_start), endMinute: parseHHMM(o.work_end), holidays };
}

export function loadTransitions(db: DB, orgId: string): TransitionRule[] {
  return (db.prepare("SELECT * FROM workflow_transitions WHERE org_id = ?").all(orgId) as any[]).map((r) => ({
    from: r.from_status, to: r.to_status, permission: r.permission, requiresComment: !!r.requires_comment,
    requiresEvidence: !!r.requires_evidence, requiresApproval: !!r.requires_approval, enabled: !!r.enabled,
  }));
}

export const DEFAULT_CATEGORIES: { name: string; keywords: string[]; sensitive?: boolean; priority?: string; ack: number; first: number; res: number }[] = [
  { name: "Service Quality", keywords: ["service", "poor", "quality", "slow", "rude", "support", "wait"], ack: 240, first: 480, res: 4800 },
  { name: "Billing & Payments", keywords: ["bill", "invoice", "charge", "charged", "refund", "payment", "overcharged"], ack: 240, first: 480, res: 2400 },
  { name: "Delays & Delivery", keywords: ["late", "delay", "delayed", "delivery", "delivered", "waiting", "shipment"], ack: 240, first: 480, res: 2400 },
  { name: "Product or Equipment Fault", keywords: ["broken", "fault", "faulty", "defect", "damaged", "repair", "malfunction", "jam", "jams"], ack: 240, first: 480, res: 3600 },
  { name: "Staff Conduct", keywords: ["staff", "behaviour", "behavior", "rude", "attitude", "unprofessional", "harass"], sensitive: true, priority: "High", ack: 120, first: 240, res: 4800 },
  { name: "Safety & Security", keywords: ["safety", "unsafe", "injury", "hazard", "danger", "security", "fire", "threat"], sensitive: true, priority: "High", ack: 60, first: 120, res: 2400 },
  { name: "Facilities", keywords: ["building", "toilet", "cleaning", "air", "conditioning", "parking", "lift", "elevator", "noise"], ack: 480, first: 960, res: 4800 },
  { name: "Other", keywords: [], ack: 480, first: 960, res: 4800 },
];

export const DEFAULT_TEMPLATES: Record<string, { subject: string; body: string; external: boolean }> = {
  acknowledgment: { external: true, subject: "We received your complaint {{ref}}", body: "Hello {{name}},\n\nThank you for contacting {{org}}. We received your complaint and its reference is {{ref}}.\n\nTrack its progress here: {{trackUrl}}\nYour access code: {{code}}\n\nPlease keep this code private. We aim to respond by {{due}}.\n\nKind regards,\n{{org}}" },
  request_info: { external: true, subject: "We need more information about {{ref}}", body: "Hello {{name}},\n\nTo continue with complaint {{ref}} we need more information:\n\n{{message}}\n\nReply here: {{trackUrl}}\n\nKind regards,\n{{org}}" },
  update: { external: true, subject: "Update on complaint {{ref}}", body: "Hello {{name}},\n\n{{message}}\n\nSee full details: {{trackUrl}}\n\nKind regards,\n{{org}}" },
  resolution: { external: true, subject: "Proposed outcome for complaint {{ref}}", body: "Hello {{name}},\n\nWe have completed our review of complaint {{ref}}.\n\nOutcome: {{message}}\n\nIf you are not satisfied you can ask us to reopen it, and tell us how we did: {{trackUrl}}\n\nKind regards,\n{{org}}" },
  closure: { external: true, subject: "Complaint {{ref}} is now closed", body: "Hello {{name}},\n\nComplaint {{ref}} has been closed. Thank you for helping us improve.\n\nPlease rate your experience: {{trackUrl}}\n\nKind regards,\n{{org}}" },
  assignment: { external: false, subject: "Complaint {{ref}} assigned to you", body: "{{ref}} - {{title}} was assigned to you. Open it: {{link}}" },
  sla_warning: { external: false, subject: "SLA warning for {{ref}}", body: "{{message}}\n{{ref}} - {{title}}\n{{link}}" },
  escalation: { external: false, subject: "Escalation: {{ref}}", body: "{{message}}\n{{ref}} - {{title}}\n{{link}}" },
};

export function createOrganization(
  db: DB,
  input: { name: string; slug: string; timezone?: string; workStart?: string; workEnd?: string; workDays?: number[]; actorId?: string | null; now?: number },
): { orgId: string; roleIds: Record<string, string> } {
  const now = input.now ?? Date.now();
  const orgId = newId();
  const roleIds: Record<string, string> = {};
  db.transaction(() => {
    db.prepare("INSERT INTO organizations (id, name, slug, timezone, work_days, work_start, work_end, created_at) VALUES (?,?,?,?,?,?,?,?)").run(
      orgId, input.name, input.slug, input.timezone ?? "UTC", JSON.stringify(input.workDays ?? [1, 2, 3, 4, 5]), input.workStart ?? "09:00", input.workEnd ?? "17:00", now,
    );
    for (const r of SYSTEM_ROLES) {
      const id = newId();
      roleIds[r.key] = id;
      db.prepare("INSERT INTO roles (id, org_id, key, name, description, is_system, created_at) VALUES (?,?,?,?,?,1,?)").run(id, orgId, r.key, r.name, r.description, now);
      const ins = db.prepare("INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)");
      for (const p of r.permissions) ins.run(id, p);
    }
    const insT = db.prepare("INSERT INTO workflow_transitions (org_id, from_status, to_status, permission, requires_comment, requires_evidence, requires_approval, enabled) VALUES (?,?,?,?,?,?,?,1)");
    for (const t of DEFAULT_TRANSITIONS) insT.run(orgId, t.from, t.to, t.permission, +t.requiresComment, +t.requiresEvidence, +t.requiresApproval);
    const insC = db.prepare("INSERT INTO categories (id, org_id, name, sensitive, default_priority, ack_minutes, first_response_minutes, resolution_minutes, keywords) VALUES (?,?,?,?,?,?,?,?,?)");
    for (const c of DEFAULT_CATEGORIES) insC.run(newId(), orgId, c.name, c.sensitive ? 1 : 0, c.priority ?? "Medium", c.ack, c.first, c.res, JSON.stringify(c.keywords));
    db.prepare("INSERT INTO departments (id, org_id, name, created_at) VALUES (?,?,?,?)").run(newId(), orgId, "Customer Care", now);
    audit(db, { orgId, actorId: input.actorId ?? null, action: "org.created", entityType: "organization", entityId: orgId, data: { name: input.name }, now });
  })();
  return { orgId, roleIds };
}

export function renderTemplate(db: DB, orgId: string, key: string, vars: Record<string, string | number | null | undefined>): { subject: string; body: string } {
  const row = db.prepare("SELECT subject, body FROM message_templates WHERE org_id = ? AND key = ?").get(orgId, key) as { subject: string; body: string } | undefined;
  const t = row ?? DEFAULT_TEMPLATES[key];
  if (!t) throw new Error(`Unknown template ${key}`);
  const fill = (s: string) => s.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(vars[k] ?? ""));
  return { subject: fill(t.subject), body: fill(t.body) };
}
