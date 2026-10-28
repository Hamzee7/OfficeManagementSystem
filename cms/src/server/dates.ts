import { zonedTimeToUtc } from "@/lib/calendar";

const DAY = 86_400_000;

function parseYmd(s: string | null | undefined): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Inclusive start date and inclusive end date (YYYY-MM-DD) in the organization's time zone -> [from, to) in UTC ms. */
export function parseRange(sp: Record<string, string | undefined>, tz: string, now = Date.now()): { from: number; to: number; fromStr: string; toStr: string } {
  const ymd = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(ms));
  const toP = parseYmd(sp.to) ?? parseYmd(ymd(now))!;
  const fromP = parseYmd(sp.from) ?? parseYmd(ymd(now - 29 * DAY))!;
  const start = zonedTimeToUtc(fromP[0], fromP[1], fromP[2], 0, tz);
  const endDay = new Date(Date.UTC(toP[0], toP[1] - 1, toP[2] + 1));
  const end = zonedTimeToUtc(endDay.getUTCFullYear(), endDay.getUTCMonth() + 1, endDay.getUTCDate(), 0, tz);
  const f = (p: [number, number, number]) => `${p[0]}-${String(p[1]).padStart(2, "0")}-${String(p[2]).padStart(2, "0")}`;
  return { from: start, to: Math.max(end, start + DAY), fromStr: f(fromP), toStr: f(toP) };
}
