import { type DB } from "./db";
import { HttpError, type AuthContext } from "./auth";
import { audit } from "./audit";
import { buildFilter, type ListFilters } from "./complaints";
import { loadCalendar, loadOrg } from "./org";
import { businessMinutesBetween } from "@/lib/calendar";
import { OPEN_STATUSES } from "@/lib/workflow";
import { tokens } from "@/lib/ai";

export interface ReportFilters {
  from: number; // inclusive
  to: number; // exclusive
  departmentId?: string;
  categoryId?: string;
  locationId?: string;
}

/**
 * Precise KPI definitions. Shown next to every number in the UI so nobody has to guess.
 *  - created:        complaints whose creation time falls in the period.
 *  - resolved:       complaints whose resolution time falls in the period (a different set from `created`).
 *  - openNow:        complaints currently in an open status (a snapshot, ignores the period).
 *  - overdueNow:     open complaints past their resolution deadline right now, SLA not paused.
 *  - slaCompliance:  of complaints resolved in the period, the share resolved on or before the deadline.
 *  - avgFirstResponse / avgResolution: mean business minutes from creation, over complaints that
 *                    received their first response / were resolved in the period.
 *  - reopenRate:     of complaints created in the period, the share that were reopened at least once.
 *  - csat:           mean 1-5 rating of surveys submitted in the period.
 */
export const KPI_DEFINITIONS: Record<string, string> = {
  created: "Complaints created during the selected period.",
  resolved: "Complaints resolved during the selected period (may have been created earlier).",
  openNow: "Complaints currently open. A live snapshot that ignores the period.",
  overdueNow: "Open complaints that are past their resolution deadline right now (paused clocks excluded).",
  slaCompliance: "Share of complaints resolved in the period that met their resolution deadline. Shown as n/a when none were resolved.",
  avgFirstResponse: "Average business time from creation to the first message to the complainant, for complaints that received one in the period.",
  avgResolution: "Average business time from creation to resolution, for complaints resolved in the period.",
  reopenRate: "Share of complaints created in the period that were reopened at least once.",
  csat: "Average 1-5 satisfaction rating from surveys submitted in the period. n/a when there are none.",
};

function reportScope(ctx: AuthContext, f: ReportFilters) {
  const base: ListFilters = { departmentId: f.departmentId, categoryId: f.categoryId, locationId: f.locationId };
  return buildFilter(ctx, base);
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

export function dashboard(db: DB, ctx: AuthContext, f: ReportFilters, now = Date.now()) {
  if (!ctx.perms.has("report.view")) throw new HttpError(403, "You do not have permission to view reports.");
  if (f.to <= f.from) throw new HttpError(422, "The end date must be after the start date.");
  if (f.to - f.from > 400 * 86_400_000) throw new HttpError(422, "Choose a period of at most 400 days.");
  const { where, params } = reportScope(ctx, f);
  const cal = loadCalendar(db, ctx.orgId);
  const org = loadOrg(db, ctx.orgId);
  const tz = org.timezone;
  void tz;

  const createdRows = db.prepare(`SELECT c.id, c.created_at, c.reopen_count, c.priority, c.channel, c.category_id, c.department_id, c.location_id FROM complaints c WHERE ${where} AND c.created_at >= ? AND c.created_at < ?`).all(...params, f.from, f.to) as any[];
  const resolvedRows = db.prepare(`SELECT c.id, c.created_at, c.resolved_at, c.resolution_due_at FROM complaints c WHERE ${where} AND c.resolved_at >= ? AND c.resolved_at < ?`).all(...params, f.from, f.to) as any[];
  const firstRows = db.prepare(`SELECT c.created_at, c.first_response_at FROM complaints c WHERE ${where} AND c.first_response_at >= ? AND c.first_response_at < ?`).all(...params, f.from, f.to) as any[];
  const openNow = (db.prepare(`SELECT COUNT(*) n FROM complaints c WHERE ${where} AND c.status IN (${OPEN_STATUSES.map(() => "?").join(",")})`).get(...params, ...OPEN_STATUSES) as { n: number }).n;
  const overdueNow = (db.prepare(`SELECT COUNT(*) n FROM complaints c WHERE ${where} AND c.status IN (${OPEN_STATUSES.map(() => "?").join(",")}) AND c.sla_paused_at IS NULL AND c.resolution_due_at < ?`).get(...params, ...OPEN_STATUSES, now) as { n: number }).n;
  const csatRow = db.prepare(`SELECT AVG(s.rating) a, COUNT(*) n FROM surveys s JOIN complaints c ON c.id = s.complaint_id WHERE ${where} AND s.created_at >= ? AND s.created_at < ?`).get(...params, f.from, f.to) as { a: number | null; n: number };

  const met = resolvedRows.filter((r) => r.resolution_due_at != null && r.resolved_at <= r.resolution_due_at).length;
  const resMins = resolvedRows.map((r) => businessMinutesBetween(r.created_at, r.resolved_at, cal));
  const frMins = firstRows.map((r) => businessMinutesBetween(r.created_at, r.first_response_at, cal));

  const group = (col: string, joinTable?: string) => {
    const sql = joinTable
      ? `SELECT COALESCE(t.name, 'Unspecified') AS label, COUNT(*) AS n FROM complaints c LEFT JOIN ${joinTable} t ON t.id = c.${col} WHERE ${where} AND c.created_at >= ? AND c.created_at < ? GROUP BY label ORDER BY n DESC LIMIT 12`
      : `SELECT c.${col} AS label, COUNT(*) AS n FROM complaints c WHERE ${where} AND c.created_at >= ? AND c.created_at < ? GROUP BY label ORDER BY n DESC`;
    return db.prepare(sql).all(...params, f.from, f.to) as { label: string; n: number }[];
  };

  // Daily series: created vs resolved, bucketed in the organization's time zone.
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: org.timezone });
  const dayKey = (ms: number) => dayFmt.format(new Date(ms));
  const series = new Map<string, { created: number; resolved: number }>();
  for (let t = f.from; t < f.to; t += 86_400_000) series.set(dayKey(t), { created: 0, resolved: 0 });
  for (const r of createdRows) { const k = dayKey(r.created_at); if (series.has(k)) series.get(k)!.created++; }
  for (const r of resolvedRows) { const k = dayKey(r.resolved_at); if (series.has(k)) series.get(k)!.resolved++; }

  // Weekly SLA compliance trend (resolved that week).
  const weekly = new Map<string, { n: number; met: number }>();
  for (const r of resolvedRows) {
    const d = new Date(r.resolved_at);
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))).toISOString().slice(0, 10);
    const w = weekly.get(monday) ?? { n: 0, met: 0 };
    w.n++;
    if (r.resolution_due_at != null && r.resolved_at <= r.resolution_due_at) w.met++;
    weekly.set(monday, w);
  }

  const buckets = [["< 1 day", 480], ["1-3 days", 1440], ["3-5 days", 2400], ["5-10 days", 4800], ["10+ days", Infinity]] as const;
  const dist = buckets.map(([label]) => ({ label, n: 0 }));
  for (const m of resMins) { const i = buckets.findIndex(([, max]) => m < max); dist[i === -1 ? buckets.length - 1 : i].n++; }

  const workload = db.prepare(
    `SELECT u.name AS label, COUNT(*) AS n FROM complaints c JOIN users u ON u.id = c.assignee_id WHERE ${where} AND c.status IN (${OPEN_STATUSES.map(() => "?").join(",")}) GROUP BY u.id ORDER BY n DESC LIMIT 12`,
  ).all(...params, ...OPEN_STATUSES) as { label: string; n: number }[];

  // Recurring themes: the most repeated significant words in complaint titles of the period.
  const titles = db.prepare(`SELECT c.title FROM complaints c WHERE ${where} AND c.created_at >= ? AND c.created_at < ? LIMIT 5000`).all(...params, f.from, f.to) as { title: string }[];
  const freq = new Map<string, number>();
  for (const t of titles) for (const w of new Set(tokens(t.title))) freq.set(w, (freq.get(w) ?? 0) + 1);
  const themes = [...freq.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([label, n]) => ({ label, n }));

  const attention = (extra: string, ...p: unknown[]) =>
    db.prepare(`SELECT c.id, c.ref, c.title, c.priority, c.status, c.resolution_due_at FROM complaints c WHERE ${where} AND ${extra} LIMIT 8`).all(...params, ...p) as any[];
  const open = OPEN_STATUSES.map(() => "?").join(",");

  return {
    period: { from: f.from, to: f.to },
    kpis: {
      created: createdRows.length,
      resolved: resolvedRows.length,
      openNow,
      overdueNow,
      slaCompliance: resolvedRows.length ? Math.round((met / resolvedRows.length) * 100) : null,
      avgFirstResponseMinutes: avg(frMins),
      avgResolutionMinutes: avg(resMins),
      reopenRate: createdRows.length ? Math.round((createdRows.filter((r) => r.reopen_count > 0).length / createdRows.length) * 100) : null,
      csat: csatRow.n ? Math.round(csatRow.a! * 10) / 10 : null,
      csatResponses: csatRow.n,
    },
    definitions: KPI_DEFINITIONS,
    volume: [...series.entries()].map(([day, v]) => ({ day, ...v })),
    byCategory: group("category_id", "categories"),
    byDepartment: group("department_id", "departments"),
    byLocation: group("location_id", "locations"),
    byPriority: group("priority"),
    byChannel: group("channel"),
    byStatus: db.prepare(`SELECT c.status AS label, COUNT(*) AS n FROM complaints c WHERE ${where} AND c.created_at >= ? AND c.created_at < ? GROUP BY label ORDER BY n DESC`).all(...params, f.from, f.to) as { label: string; n: number }[],
    slaTrend: [...weekly.entries()].sort().map(([week, v]) => ({ week, resolved: v.n, compliancePct: Math.round((v.met / v.n) * 100) })),
    resolutionDistribution: dist,
    workload,
    themes,
    attention: {
      critical: attention(`c.priority = 'Critical' AND c.status IN (${open})`, ...OPEN_STATUSES),
      approachingSla: attention(`c.status IN (${open}) AND c.sla_paused_at IS NULL AND c.resolution_due_at >= ? AND c.resolution_due_at < ?`, ...OPEN_STATUSES, now, now + 24 * 3600_000),
      unassigned: attention(`c.assignee_id IS NULL AND c.status IN (${open})`, ...OPEN_STATUSES),
      awaitingApproval: attention("c.status = 'Pending Approval'"),
      reopened: attention("c.status = 'Reopened'"),
    },
    generatedAt: now,
  };
}

const csvCell = (v: unknown): string => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const EXPORT_ROW_LIMIT = 10_000;

/** CSV export with the same row-level scope as the lists, field-level PII rules, a hard row cap and an audit record. */
export function exportComplaintsCsv(db: DB, ctx: AuthContext, filters: ListFilters, ip?: string | null, now = Date.now()): { csv: string; rows: number; truncated: boolean } {
  if (!ctx.perms.has("report.export")) throw new HttpError(403, "You do not have permission to export reports.");
  const { where, params } = buildFilter(ctx, filters);
  const rows = db.prepare(
    `SELECT c.ref, c.title, c.status, c.priority, c.channel, c.created_at, c.resolved_at, c.closed_at, c.resolution_due_at, c.reopen_count,
       cat.name AS category, d.name AS department, l.name AS location, u.name AS assignee,
       c.complainant_name, c.complainant_email, c.complainant_phone
     FROM complaints c LEFT JOIN categories cat ON cat.id = c.category_id LEFT JOIN departments d ON d.id = c.department_id
     LEFT JOIN locations l ON l.id = c.location_id LEFT JOIN users u ON u.id = c.assignee_id
     WHERE ${where} ORDER BY c.created_at DESC LIMIT ?`,
  ).all(...params, EXPORT_ROW_LIMIT + 1) as any[];
  const truncated = rows.length > EXPORT_ROW_LIMIT;
  const out = truncated ? rows.slice(0, EXPORT_ROW_LIMIT) : rows;
  const pii = ctx.perms.has("complainant.pii.view");
  const iso = (n: number | null) => (n ? new Date(n).toISOString() : "");
  const header = ["Reference", "Title", "Status", "Priority", "Channel", "Category", "Department", "Location", "Assignee", "Created", "Resolved", "Closed", "Resolution due", "Reopened times", ...(pii ? ["Complainant", "Email", "Phone"] : [])];
  const lines = [header.join(",")];
  for (const r of out) {
    lines.push([r.ref, r.title, r.status, r.priority, r.channel, r.category, r.department, r.location, r.assignee, iso(r.created_at), iso(r.resolved_at), iso(r.closed_at), iso(r.resolution_due_at), r.reopen_count, ...(pii ? [r.complainant_name, r.complainant_email, r.complainant_phone] : [])].map(csvCell).join(","));
  }
  audit(db, { orgId: ctx.orgId, actorId: ctx.userId, actorLabel: ctx.email, action: "report.exported", entityType: "complaints", ip, data: { rows: out.length, truncated, includesPersonalData: pii }, now });
  return { csv: lines.join("\n"), rows: out.length, truncated };
}
