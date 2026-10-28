/**
 * Escalation rules. Pure: evaluates one complaint at one moment and returns the escalations
 * that apply. The worker persists them idempotently (one row per complaint + rule key + level).
 */
import type { SlaSnapshot } from "./sla";

export type EscalationRuleKey =
  | "deadline_approaching"
  | "sla_breached"
  | "critical_unassigned"
  | "no_first_response"
  | "unresolved_too_long"
  | "repeatedly_reopened";

export interface EscalationSettings {
  criticalUnassignedMinutes: number; // business minutes a Critical complaint may wait without an owner
  unresolvedBreachMultiple: number; // escalate again when this many times past the SLA window
  reopenThreshold: number;
}

export const DEFAULT_ESCALATION_SETTINGS: EscalationSettings = {
  criticalUnassignedMinutes: 60,
  unresolvedBreachMultiple: 2,
  reopenThreshold: 2,
};

export interface EscalationInput {
  priority: string;
  status: string;
  assigneeId: string | null;
  sla: SlaSnapshot;
  firstResponseAt: number | null;
  firstResponseDue: number | null;
  /** Business minutes since creation (used for the unassigned check). */
  minutesSinceCreated: number;
  reopenCount: number;
}

export interface EscalationHit {
  ruleKey: EscalationRuleKey;
  level: number; // 1 = handler's manager, 2 = escalation authority (admin)
  message: string;
  notify: ("assignee" | "manager" | "admin")[];
}

export function evaluateEscalations(i: EscalationInput, now: number, s: EscalationSettings = DEFAULT_ESCALATION_SETTINGS): EscalationHit[] {
  const hits: EscalationHit[] = [];
  const done = ["Resolved", "Closed", "Rejected", "Draft"].includes(i.status);
  if (done) return hits;

  if (i.sla.state === "At Risk") {
    hits.push({ ruleKey: "deadline_approaching", level: 1, message: `Resolution deadline is approaching (${i.sla.consumedPct}% of the SLA used).`, notify: ["assignee", "manager"] });
  }
  if (i.sla.state === "Breached") {
    hits.push({ ruleKey: "sla_breached", level: 1, message: "The resolution SLA has been breached.", notify: ["assignee", "manager"] });
    if (i.sla.totalMinutes > 0 && i.sla.elapsedMinutes >= i.sla.totalMinutes * s.unresolvedBreachMultiple) {
      hits.push({ ruleKey: "unresolved_too_long", level: 2, message: `Unresolved for more than ${s.unresolvedBreachMultiple}x the SLA window.`, notify: ["manager", "admin"] });
    }
  }
  if (i.priority === "Critical" && !i.assigneeId && i.minutesSinceCreated >= s.criticalUnassignedMinutes) {
    hits.push({ ruleKey: "critical_unassigned", level: 2, message: "A critical complaint has no owner.", notify: ["manager", "admin"] });
  }
  if ((i.priority === "High" || i.priority === "Critical") && !i.firstResponseAt && i.firstResponseDue != null && now > i.firstResponseDue) {
    hits.push({ ruleKey: "no_first_response", level: 1, message: "A high-priority complaint has not received a first response.", notify: ["assignee", "manager"] });
  }
  if (i.reopenCount >= s.reopenThreshold) {
    hits.push({ ruleKey: "repeatedly_reopened", level: 2, message: `Reopened ${i.reopenCount} times.`, notify: ["manager", "admin"] });
  }
  return hits;
}
