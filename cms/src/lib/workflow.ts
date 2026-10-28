/**
 * Controlled complaint lifecycle. Transitions are data (stored per organization),
 * so organizations can configure them without code changes.
 */
import type { Permission } from "./permissions";

export const STATUSES = [
  "Draft",
  "Submitted",
  "Acknowledged",
  "Under Review",
  "Assigned",
  "Investigation in Progress",
  "Awaiting Complainant",
  "Awaiting Internal Department",
  "Resolution Proposed",
  "Pending Approval",
  "Resolved",
  "Closed",
  "Reopened",
  "Rejected",
] as const;

export type Status = (typeof STATUSES)[number];

/** Statuses during which the SLA clock does not run. */
export const PAUSED_STATUSES: Status[] = ["Awaiting Complainant"];
/** Statuses in which a complaint counts as still open work. */
export const OPEN_STATUSES: Status[] = STATUSES.filter(
  (s) => !["Draft", "Resolved", "Closed", "Rejected"].includes(s),
) as Status[];
export const TERMINAL_STATUSES: Status[] = ["Closed", "Rejected"];

export interface TransitionRule {
  from: Status;
  to: Status;
  permission: Permission | null; // null = any authenticated handler/manager with complaint access
  requiresComment: boolean;
  requiresEvidence: boolean;
  requiresApproval: boolean; // target status can only be reached through an approval decision
  enabled: boolean;
}

const t = (
  from: Status,
  to: Status,
  o: Partial<Omit<TransitionRule, "from" | "to">> = {},
): TransitionRule => ({
  from,
  to,
  permission: "complaint.transition",
  requiresComment: false,
  requiresEvidence: false,
  requiresApproval: false,
  enabled: true,
  ...o,
});

/** Default workflow seeded for every new organization. */
export const DEFAULT_TRANSITIONS: TransitionRule[] = [
  t("Draft", "Submitted"),
  t("Submitted", "Acknowledged"),
  t("Submitted", "Under Review"),
  t("Submitted", "Rejected", { permission: "complaint.approve", requiresComment: true }),
  t("Acknowledged", "Under Review"),
  t("Acknowledged", "Rejected", { permission: "complaint.approve", requiresComment: true }),
  t("Under Review", "Assigned", { permission: "complaint.assign" }),
  t("Under Review", "Rejected", { permission: "complaint.approve", requiresComment: true }),
  t("Assigned", "Investigation in Progress"),
  t("Assigned", "Under Review", { permission: "complaint.assign", requiresComment: true }),
  t("Investigation in Progress", "Awaiting Complainant", { requiresComment: true }),
  t("Investigation in Progress", "Awaiting Internal Department", { requiresComment: true }),
  t("Investigation in Progress", "Resolution Proposed", { requiresComment: true }),
  t("Awaiting Complainant", "Investigation in Progress"),
  t("Awaiting Internal Department", "Investigation in Progress"),
  t("Resolution Proposed", "Pending Approval", { requiresComment: true }),
  t("Resolution Proposed", "Investigation in Progress", { requiresComment: true }),
  // Reached only through an approval decision, never by a plain status change.
  t("Pending Approval", "Resolved", { permission: "complaint.approve", requiresApproval: true }),
  t("Pending Approval", "Investigation in Progress", { permission: "complaint.approve", requiresComment: true }),
  t("Resolved", "Closed", { permission: "complaint.approve" }), // only managers close
  t("Resolved", "Reopened", { permission: null, requiresComment: true }), // complainant or staff
  t("Closed", "Reopened", { permission: "complaint.approve", requiresComment: true }),
  t("Reopened", "Assigned", { permission: "complaint.assign" }),
  t("Reopened", "Investigation in Progress"),
];

export type Actor =
  | { kind: "user"; perms: ReadonlySet<string> }
  | { kind: "complainant" }
  | { kind: "system" };

export interface TransitionContext {
  comment?: string | null;
  evidenceCount?: number;
  /** True only when the move is being executed by the approval flow. */
  viaApproval?: boolean;
  /** Whether the organization requires manager approval before resolving. */
  approvalRequired?: boolean;
  assigneeId?: string | null;
}

export interface TransitionCheck {
  ok: boolean;
  reasons: string[];
  rule?: TransitionRule;
}

export function findRule(rules: TransitionRule[], from: Status, to: Status): TransitionRule | undefined {
  return rules.find((r) => r.from === from && r.to === to && r.enabled);
}

export function allowedTransitions(rules: TransitionRule[], from: Status, actor: Actor, ctx: TransitionContext = {}): TransitionRule[] {
  return rules.filter((r) => r.from === from && r.enabled && checkTransition(rules, from, r.to, actor, { ...ctx, comment: "x", evidenceCount: 99 }).ok);
}

/**
 * Decide whether `actor` may move a complaint from `from` to `to`.
 * Returns every reason a transition is refused so the UI and API can explain it.
 */
export function checkTransition(
  rules: TransitionRule[],
  from: Status,
  to: Status,
  actor: Actor,
  ctx: TransitionContext = {},
): TransitionCheck {
  const rule = findRule(rules, from, to);
  if (!rule) return { ok: false, reasons: [`Moving from "${from}" to "${to}" is not allowed.`] };

  const reasons: string[] = [];

  if (actor.kind === "complainant") {
    // Complainants may only request reopening of a resolved complaint.
    if (!(from === "Resolved" && to === "Reopened")) reasons.push("Complainants can only request to reopen a resolved complaint.");
  } else if (actor.kind === "user") {
    if (rule.permission && !actor.perms.has(rule.permission)) {
      reasons.push("You do not have permission to make this change.");
    }
    if (!rule.permission && !(actor.perms.has("complaint.transition") || actor.perms.has("complaint.view.all"))) {
      reasons.push("You do not have permission to make this change.");
    }
  }

  if (rule.requiresApproval && !ctx.viaApproval && ctx.approvalRequired !== false) {
    reasons.push("This step needs a manager's approval decision. Use the approval controls.");
  }
  if (rule.requiresComment && !(ctx.comment && ctx.comment.trim().length >= 3)) {
    reasons.push("A comment explaining this change is required.");
  }
  if (rule.requiresEvidence && !(ctx.evidenceCount && ctx.evidenceCount > 0)) {
    reasons.push("Evidence must be attached first.");
  }
  if (to === "Closed" && actor.kind === "complainant") reasons.push("Only staff can close a complaint.");

  return { ok: reasons.length === 0, reasons, rule };
}
