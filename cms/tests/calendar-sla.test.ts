import { describe, it, expect } from "vitest";
import { addBusinessMinutes, businessMinutesBetween, zonedTimeToUtc, parseHHMM, type BusinessCalendar } from "@/lib/calendar";
import { computeDeadlines, slaSnapshot, pauseClock, resumeClock, scaledPolicy } from "@/lib/sla";

const utcCal: BusinessCalendar = { timezone: "UTC", workDays: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 1020, holidays: new Set() };
const at = (iso: string) => Date.parse(iso);

describe("business calendar", () => {
  it("adds minutes within a working day", () => {
    expect(addBusinessMinutes(at("2026-03-02T10:00:00Z"), 120, utcCal)).toBe(at("2026-03-02T12:00:00Z"));
  });
  it("rolls over to the next working morning", () => {
    // Monday 16:00 + 2h = 1h left Monday, 1h Tuesday morning
    expect(addBusinessMinutes(at("2026-03-02T16:00:00Z"), 120, utcCal)).toBe(at("2026-03-03T10:00:00Z"));
  });
  it("skips weekends", () => {
    // Friday 16:30 + 60 min: 30 on Friday, 30 on Monday
    expect(addBusinessMinutes(at("2026-03-06T16:30:00Z"), 60, utcCal)).toBe(at("2026-03-09T09:30:00Z"));
  });
  it("starts counting at opening time when created after hours", () => {
    expect(addBusinessMinutes(at("2026-03-02T20:00:00Z"), 60, utcCal)).toBe(at("2026-03-03T10:00:00Z"));
  });
  it("skips holidays", () => {
    const cal = { ...utcCal, holidays: new Set(["2026-03-03"]) };
    expect(addBusinessMinutes(at("2026-03-02T16:00:00Z"), 120, cal)).toBe(at("2026-03-04T10:00:00Z"));
  });
  it("counts business minutes between instants and is consistent with addBusinessMinutes", () => {
    const start = at("2026-03-05T15:00:00Z");
    const end = addBusinessMinutes(start, 600, utcCal);
    expect(businessMinutesBetween(start, end, utcCal)).toBe(600);
    expect(businessMinutesBetween(at("2026-03-07T10:00:00Z"), at("2026-03-08T10:00:00Z"), utcCal)).toBe(0);
  });
  it("handles time zones: Karachi 09:00 is 04:00 UTC", () => {
    const khi: BusinessCalendar = { ...utcCal, timezone: "Asia/Karachi" };
    expect(addBusinessMinutes(at("2026-03-02T03:00:00Z"), 60, khi)).toBe(at("2026-03-02T05:00:00Z")); // opens 04:00Z
  });
  it("handles daylight saving: New York spring-forward on 2026-03-08", () => {
    const ny: BusinessCalendar = { ...utcCal, timezone: "America/New_York", workDays: [0, 1, 2, 3, 4, 5, 6] };
    // Before DST (EST, UTC-5): 09:00 local = 14:00Z. After (EDT, UTC-4): 09:00 local = 13:00Z.
    expect(zonedTimeToUtc(2026, 3, 7, 540, "America/New_York")).toBe(at("2026-03-07T14:00:00Z"));
    expect(zonedTimeToUtc(2026, 3, 9, 540, "America/New_York")).toBe(at("2026-03-09T13:00:00Z"));
    // 8h window starting Saturday 16:00 local crosses the DST change; deadline lands in local working time.
    const due = addBusinessMinutes(zonedTimeToUtc(2026, 3, 7, 960, "America/New_York"), 120, ny);
    expect(due).toBe(zonedTimeToUtc(2026, 3, 8, 600, "America/New_York")); // 1h Sat + 1h Sun 09:00-10:00
  });
  it("parses HH:MM and rejects bad input", () => {
    expect(parseHHMM("09:30")).toBe(570);
    expect(() => parseHHMM("9am")).toThrow();
  });
});

describe("SLA", () => {
  const policy = { ackMinutes: 60, firstResponseMinutes: 240, resolutionMinutes: 960, atRiskPct: 75 };
  it("scales targets by priority", () => {
    expect(scaledPolicy(policy, "Critical").resolutionMinutes).toBe(240);
    expect(scaledPolicy(policy, "Low").resolutionMinutes).toBe(1440);
  });
  it("computes deadlines on the business calendar", () => {
    const d = computeDeadlines(at("2026-03-02T09:00:00Z"), policy, "Medium", utcCal);
    expect(d.ackDueAt).toBe(at("2026-03-02T10:00:00Z"));
    expect(d.resolutionDueAt).toBe(at("2026-03-03T17:00:00Z")); // 960 min = 2 working days
  });
  it("reports On Track, At Risk, Breached", () => {
    const created = at("2026-03-02T09:00:00Z");
    const resolutionDueAt = computeDeadlines(created, policy, "Medium", utcCal).resolutionDueAt;
    const base = { createdAt: created, resolutionDueAt, resolutionMinutes: 960, pausedAt: null, pausedRemainingMinutes: null, resolvedAt: null, atRiskPct: 75 };
    expect(slaSnapshot(base, at("2026-03-02T11:00:00Z"), utcCal).state).toBe("On Track");
    expect(slaSnapshot(base, at("2026-03-03T11:00:00Z"), utcCal).state).toBe("On Track");
    expect(slaSnapshot(base, at("2026-03-03T14:00:00Z"), utcCal).state).toBe("At Risk");
    const breached = slaSnapshot(base, at("2026-03-04T10:00:00Z"), utcCal);
    expect(breached.state).toBe("Breached");
    expect(breached.remainingMinutes).toBe(-60);
  });
  it("pauses and resumes without losing remaining time", () => {
    const created = at("2026-03-02T09:00:00Z");
    const due = computeDeadlines(created, policy, "Medium", utcCal).resolutionDueAt;
    const pausedAt = at("2026-03-02T13:00:00Z");
    const remaining = pauseClock(due, pausedAt, utcCal);
    expect(remaining).toBe(960 - 240);
    const snap = slaSnapshot({ createdAt: created, resolutionDueAt: due, resolutionMinutes: 960, pausedAt, pausedRemainingMinutes: remaining, resolvedAt: null, atRiskPct: 75 }, at("2026-03-09T09:00:00Z"), utcCal);
    expect(snap.state).toBe("Paused");
    expect(snap.remainingMinutes).toBe(720); // stays frozen however long it is paused
    expect(resumeClock(remaining, at("2026-03-09T09:00:00Z"), utcCal)).toBe(at("2026-03-10T13:00:00Z"));
  });
  it("marks completed work", () => {
    const created = at("2026-03-02T09:00:00Z");
    const due = at("2026-03-03T17:00:00Z");
    const snap = slaSnapshot({ createdAt: created, resolutionDueAt: due, resolutionMinutes: 960, pausedAt: null, pausedRemainingMinutes: null, resolvedAt: at("2026-03-02T15:00:00Z"), atRiskPct: 75 }, at("2026-04-01T00:00:00Z"), utcCal);
    expect(snap.state).toBe("Completed");
    expect(snap.remainingMinutes).toBeGreaterThan(0);
  });
});
