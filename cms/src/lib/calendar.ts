/**
 * Business calendar arithmetic. All instants are UTC milliseconds; the organization's
 * time zone, working days, working hours and holidays only decide which instants count.
 * Time-zone and daylight-saving handling uses the platform's Intl database.
 */
export interface BusinessCalendar {
  timezone: string; // IANA, e.g. "Asia/Karachi"
  workDays: number[]; // 0 = Sunday ... 6 = Saturday
  startMinute: number; // minutes after local midnight, e.g. 540 for 09:00
  endMinute: number; // e.g. 1020 for 17:00
  holidays: ReadonlySet<string>; // "YYYY-MM-DD" in the organization's local calendar
}

export const DEFAULT_CALENDAR: BusinessCalendar = {
  timezone: "UTC",
  workDays: [1, 2, 3, 4, 5],
  startMinute: 9 * 60,
  endMinute: 17 * 60,
  holidays: new Set(),
};

export function parseHHMM(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) throw new Error(`Invalid time "${s}", expected HH:MM`);
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59) throw new Error(`Invalid time "${s}"`);
  return h * 60 + mi;
}

const MIN = 60_000;

interface Parts {
  y: number;
  m: number;
  d: number;
  hh: number;
  mm: number;
  weekday: number;
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  return f;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function zonedParts(ms: number, tz: string): Parts {
  const out: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) out[p.type] = p.value;
  return {
    y: Number(out.year),
    m: Number(out.month),
    d: Number(out.day),
    hh: Number(out.hour) % 24,
    mm: Number(out.minute),
    weekday: WEEKDAYS[out.weekday],
  };
}

/** Convert a wall-clock time in `tz` to a UTC instant. Skipped (spring-forward) times move forward. */
export function zonedTimeToUtc(y: number, m: number, d: number, minuteOfDay: number, tz: string): number {
  const naive = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  // Two passes converge across offset changes.
  let guess = naive;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(guess, tz);
    const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    const diff = naive - asUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return guess;
}

export function localDateKey(ms: number, tz: string): string {
  const p = zonedParts(ms, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function isBusinessDay(y: number, m: number, d: number, cal: BusinessCalendar): boolean {
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return cal.workDays.includes(weekday) && !cal.holidays.has(key);
}

/** The working window [start, end) in UTC for the local calendar date, or null on non-working days. */
function windowFor(y: number, m: number, d: number, cal: BusinessCalendar): [number, number] | null {
  if (!isBusinessDay(y, m, d, cal)) return null;
  const s = zonedTimeToUtc(y, m, d, cal.startMinute, cal.timezone);
  const e = zonedTimeToUtc(y, m, d, cal.endMinute, cal.timezone);
  return e > s ? [s, e] : null;
}

function nextLocalDate(y: number, m: number, d: number): [number, number, number] {
  const n = new Date(Date.UTC(y, m - 1, d + 1));
  return [n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate()];
}

/** Add business minutes to an instant. Time outside working hours or on holidays does not count. */
export function addBusinessMinutes(startMs: number, minutes: number, cal: BusinessCalendar): number {
  if (minutes <= 0) return startMs;
  if (cal.workDays.length === 0) throw new Error("Calendar has no working days");
  let remaining = minutes * MIN;
  const p = zonedParts(startMs, cal.timezone);
  let [y, m, d] = [p.y, p.m, p.d];
  let cursor = startMs;
  for (let guard = 0; guard < 3660; guard++) {
    const w = windowFor(y, m, d, cal);
    if (w) {
      const from = Math.max(cursor, w[0]);
      if (from < w[1]) {
        const avail = w[1] - from;
        if (remaining <= avail) return from + remaining;
        remaining -= avail;
      }
    }
    [y, m, d] = nextLocalDate(y, m, d);
    cursor = 0;
  }
  throw new Error("Could not place deadline within 10 years; check the calendar");
}

/** Count business minutes between two instants (0 if end <= start). */
export function businessMinutesBetween(startMs: number, endMs: number, cal: BusinessCalendar): number {
  if (endMs <= startMs) return 0;
  const p = zonedParts(startMs, cal.timezone);
  let [y, m, d] = [p.y, p.m, p.d];
  let total = 0;
  for (let guard = 0; guard < 3660; guard++) {
    if (zonedTimeToUtc(y, m, d, 0, cal.timezone) >= endMs) break;
    const w = windowFor(y, m, d, cal);
    if (w) {
      const a = Math.max(startMs, w[0]);
      const b = Math.min(endMs, w[1]);
      if (b > a) total += b - a;
    }
    [y, m, d] = nextLocalDate(y, m, d);
  }
  return Math.round(total / MIN);
}
