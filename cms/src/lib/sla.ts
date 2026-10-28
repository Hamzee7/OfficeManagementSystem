/**
 * Service-level agreement clock. Deadlines are measured in business minutes on the
 * organization's calendar. The clock can pause (e.g. awaiting the complainant) and resume.
 */
import { addBusinessMinutes, businessMinutesBetween, type BusinessCalendar } from "./calendar";

export interface SlaPolicy {
  ackMinutes: number;
  firstResponseMinutes: number;
  resolutionMinutes: number;
  atRiskPct: number; // e.g. 75 means "At Risk" once 75% of the window has been used
}

/** Priority shortens (or lengthens) the category's targets. Critical is twice as fast as Medium. */
export const PRIORITY_FACTOR = { Low: 1.5, Medium: 1, High: 0.5, Critical: 0.25 } as const;
export type Priority = keyof typeof PRIORITY_FACTOR;
export const PRIORITIES: Priority[] = ["Low", "Medium", "High", "Critical"];

export function scaledPolicy(policy: SlaPolicy, priority: Priority): SlaPolicy {
  const f = PRIORITY_FACTOR[priority];
  const s = (n: number) => Math.max(1, Math.round(n * f));
  return {
    ackMinutes: s(policy.ackMinutes),
    firstResponseMinutes: s(policy.firstResponseMinutes),
    resolutionMinutes: s(policy.resolutionMinutes),
    atRiskPct: policy.atRiskPct,
  };
}

export interface Deadlines {
  ackDueAt: number;
  firstResponseDueAt: number;
  resolutionDueAt: number;
}

export function computeDeadlines(createdAt: number, policy: SlaPolicy, priority: Priority, cal: BusinessCalendar): Deadlines {
  const p = scaledPolicy(policy, priority);
  return {
    ackDueAt: addBusinessMinutes(createdAt, p.ackMinutes, cal),
    firstResponseDueAt: addBusinessMinutes(createdAt, p.firstResponseMinutes, cal),
    resolutionDueAt: addBusinessMinutes(createdAt, p.resolutionMinutes, cal),
  };
}

export type SlaState = "On Track" | "At Risk" | "Breached" | "Paused" | "Completed";

export interface SlaSnapshot {
  state: SlaState;
  elapsedMinutes: number;
  totalMinutes: number;
  remainingMinutes: number; // negative when breached
  consumedPct: number;
  dueAt: number | null;
}

export interface SlaInput {
  createdAt: number;
  resolutionDueAt: number | null;
  resolutionMinutes: number; // scaled total window
  pausedAt: number | null;
  pausedRemainingMinutes: number | null;
  resolvedAt: number | null;
  closedAt?: number | null;
  atRiskPct: number;
}

export function slaSnapshot(i: SlaInput, now: number, cal: BusinessCalendar): SlaSnapshot {
  const total = Math.max(1, i.resolutionMinutes);
  if (i.resolvedAt || i.closedAt) {
    const end = (i.resolvedAt ?? i.closedAt)!;
    const used = businessMinutesBetween(i.createdAt, end, cal);
    const breached = i.resolutionDueAt != null && end > i.resolutionDueAt;
    return {
      state: "Completed",
      elapsedMinutes: used,
      totalMinutes: total,
      remainingMinutes: breached ? -(businessMinutesBetween(i.resolutionDueAt!, end, cal)) : Math.max(0, total - used),
      consumedPct: Math.round((used / total) * 100),
      dueAt: i.resolutionDueAt,
    };
  }
  if (i.pausedAt != null && i.pausedRemainingMinutes != null) {
    const remaining = i.pausedRemainingMinutes;
    return {
      state: "Paused",
      elapsedMinutes: Math.max(0, total - remaining),
      totalMinutes: total,
      remainingMinutes: remaining,
      consumedPct: Math.min(100, Math.round(((total - remaining) / total) * 100)),
      dueAt: i.resolutionDueAt,
    };
  }
  const due = i.resolutionDueAt ?? addBusinessMinutes(i.createdAt, total, cal);
  if (now >= due) {
    const over = businessMinutesBetween(due, now, cal);
    return { state: "Breached", elapsedMinutes: total + over, totalMinutes: total, remainingMinutes: -over, consumedPct: Math.round(((total + over) / total) * 100), dueAt: due };
  }
  const remaining = businessMinutesBetween(now, due, cal);
  const elapsed = Math.max(0, total - remaining);
  const pct = Math.round((elapsed / total) * 100);
  return { state: pct >= i.atRiskPct ? "At Risk" : "On Track", elapsedMinutes: elapsed, totalMinutes: total, remainingMinutes: remaining, consumedPct: pct, dueAt: due };
}

/** Pause: remember how many business minutes were left. */
export function pauseClock(resolutionDueAt: number, now: number, cal: BusinessCalendar): number {
  return businessMinutesBetween(now, resolutionDueAt, cal);
}

/** Resume: a new due date after the remaining business minutes. */
export function resumeClock(remainingMinutes: number, now: number, cal: BusinessCalendar): number {
  return addBusinessMinutes(now, Math.max(0, remainingMinutes), cal);
}

export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const m = Math.abs(Math.round(minutes));
  if (m < 60) return `${sign}${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${sign}${h}h ${m % 60}m`;
  return `${sign}${Math.floor(h / 24)}d ${h % 24}h`;
}
