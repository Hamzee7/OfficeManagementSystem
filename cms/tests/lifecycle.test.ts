import { describe, it, expect } from "vitest";
import { makeWorld, ctxFor, LONG, addUser } from "./helpers";
import { submitComplaint, transitionComplaint, proposeResolution, decideApproval, getComplaintDetail, assignComplaint, addInternalNote, sendMessage, getComplaintRow, listComplaints } from "@/server/complaints";
import { verifyAccess, publicView, complainantMessage, complainantReopen, complainantFeedback } from "@/server/portal";
import { runSlaSweep } from "@/server/escalate";
import { HttpError } from "@/server/auth";
import { verifyAuditChain } from "@/server/audit";

const DAY = 86_400_000;
const T0 = Date.parse("2026-03-02T09:00:00Z"); // a Monday, 09:00 UTC (UTC calendar 09-17)

const submit = (w: ReturnType<typeof makeWorld>, extra: object = {}, now = T0) =>
  submitComplaint(w.db, w.orgId, { title: "Copier keeps jamming", description: LONG, name: "Sam Customer", email: "sam@example.com", consent: true, now, ...extra });

describe("complaint lifecycle, end to end", () => {
  it("runs submit -> assign -> investigate -> propose -> approve -> resolve -> close with a complete history", () => {
    const w = makeWorld();
    const r = submit(w);
    expect(r.ref).toMatch(/^CMP-2026-\d{6}$/);
    expect(r.accessCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    // auto-assigned to a handler and visible to them only
    expect(r.assigneeId).toBeTruthy();
    expect(r.status).toBe("Assigned");
    const handlerId = r.assigneeId!;
    const who = handlerId === w.users.handler ? "handler" : "handler2"; // admins are never auto-assigned
    const handler = ctxFor(w, who, T0);
    const manager = ctxFor(w, "manager", T0);
    const manager2 = ctxFor(w, "manager2", T0);

    transitionComplaint(w.db, handler, r.id, "Investigation in Progress", { now: T0 + 3600_000 });
    addInternalNote(w.db, handler, r.id, "Called the engineer; part on order.", T0 + 2 * 3600_000);
    sendMessage(w.db, handler, r.id, "We are looking into this and will update you tomorrow.", "update", T0 + 3 * 3600_000);
    expect(getComplaintRow(w.db, w.orgId, r.id)!.first_response_at).toBe(T0 + 3 * 3600_000);

    // cannot jump straight to Resolved
    expect(() => transitionComplaint(w.db, handler, r.id, "Resolved", { now: T0 + 4 * 3600_000 })).toThrow(/not allowed/);
    const approvalId = proposeResolution(w.db, handler, r.id, "Engineer replaced the feed roller and tested 200 pages.", T0 + 5 * 3600_000);
    expect(getComplaintRow(w.db, w.orgId, r.id)!.status).toBe("Pending Approval");

    // handlers cannot approve; the proposer cannot approve their own work
    expect(() => decideApproval(w.db, handler, approvalId, true, "ok", T0 + DAY)).toThrow(/permission/);
    decideApproval(w.db, manager, approvalId, true, "Looks good", T0 + DAY);
    const resolved = getComplaintRow(w.db, w.orgId, r.id)!;
    expect(resolved.status).toBe("Resolved");
    expect(resolved.resolution_summary).toContain("feed roller");
    expect(() => decideApproval(w.db, manager2, approvalId, true, "again", T0 + DAY)).toThrow(/already been decided/);

    // the complainant is emailed the outcome, and only the outcome
    const mails = w.db.prepare("SELECT template, body FROM outbox WHERE complaint_id = ? ORDER BY created_at").all(r.id) as any[];
    expect(mails.map((m) => m.template)).toEqual(expect.arrayContaining(["acknowledgment", "update", "resolution"]));
    expect(mails.some((m) => m.body.includes("Called the engineer"))).toBe(false);

    // staff cannot close without approve permission; manager can
    expect(() => transitionComplaint(w.db, handler, r.id, "Closed", { now: T0 + 2 * DAY })).toThrow(/permission/);
    transitionComplaint(w.db, manager, r.id, "Closed", { now: T0 + 2 * DAY });

    const detail = getComplaintDetail(w.db, manager, r.id, T0 + 2 * DAY);
    const types = detail.events.map((e: any) => e.type);
    expect(types).toEqual(expect.arrayContaining(["submitted", "status", "assignment", "note", "message", "resolution_proposed", "approval_approved"]));
    expect(detail.sla.state).toBe("Completed");
    expect(detail.assignments.length).toBe(1);
    expect(verifyAuditChain(w.db).ok).toBe(true);
  });

  it("rejects invalid transitions and requires comments", () => {
    const w = makeWorld();
    const r = submit(w);
    const manager = ctxFor(w, "manager");
    expect(() => transitionComplaint(w.db, manager, r.id, "Closed")).toThrow(HttpError);
    // Investigation -> Awaiting Complainant needs a comment
    transitionComplaint(w.db, manager, r.id, "Investigation in Progress");
    expect(() => transitionComplaint(w.db, manager, r.id, "Awaiting Complainant")).toThrow(/comment/);
    transitionComplaint(w.db, manager, r.id, "Awaiting Complainant", { comment: "Need the serial number" });
  });

  it("pauses the SLA while awaiting the complainant and resumes when they reply", () => {
    const w = makeWorld();
    const r = submit(w);
    const manager = ctxFor(w, "manager", T0);
    transitionComplaint(w.db, manager, r.id, "Investigation in Progress", { now: T0 + 3600_000 });
    const before = getComplaintRow(w.db, w.orgId, r.id)!;
    transitionComplaint(w.db, manager, r.id, "Awaiting Complainant", { comment: "Please send a photo", now: T0 + 2 * 3600_000 });
    const paused = getComplaintRow(w.db, w.orgId, r.id)!;
    expect(paused.sla_paused_at).toBe(T0 + 2 * 3600_000);
    // a week passes; the paused complaint never escalates for SLA
    runSlaSweep(w.db, T0 + 14 * DAY);
    expect(w.db.prepare("SELECT COUNT(*) n FROM escalations WHERE complaint_id = ? AND rule_key IN ('sla_breached','deadline_approaching')").get(r.id)).toEqual({ n: 0 });
    const c = verifyAccess(w.db, r.ref, r.accessCode, "1.1.1.1", T0 + 14 * DAY);
    complainantMessage(w.db, c, "Photo attached in the next message", T0 + 14 * DAY);
    const resumed = getComplaintRow(w.db, w.orgId, r.id)!;
    expect(resumed.status).toBe("Investigation in Progress");
    expect(resumed.sla_paused_at).toBeNull();
    expect(resumed.resolution_due_at!).toBeGreaterThan(T0 + 14 * DAY);
    expect(before.resolution_due_at!).toBeLessThan(T0 + 14 * DAY);
  });

  it("escalates overdue cases once, to the right people, even if the sweep runs repeatedly", () => {
    const w = makeWorld();
    const r = submit(w, { priority: "Critical" });
    const later = T0 + 30 * DAY;
    const first = runSlaSweep(w.db, later);
    const second = runSlaSweep(w.db, later + 1000);
    expect(first.created).toBeGreaterThan(0);
    expect(second.created).toBe(0);
    const rules = (w.db.prepare("SELECT rule_key FROM escalations WHERE complaint_id = ?").all(r.id) as any[]).map((x) => x.rule_key);
    expect(rules).toEqual(expect.arrayContaining(["sla_breached"]));
    const notified = w.db.prepare("SELECT DISTINCT user_id FROM notifications WHERE type = 'escalation'").all() as any[];
    expect(notified.length).toBeGreaterThan(0);
    // duplicate-notification prevention at the database level
    const count = (w.db.prepare("SELECT COUNT(*) n FROM notifications WHERE type='escalation'").get() as any).n;
    runSlaSweep(w.db, later + 2000);
    expect((w.db.prepare("SELECT COUNT(*) n FROM notifications WHERE type='escalation'").get() as any).n).toBe(count);
  });

  it("keeps sensitive complaints unassigned for a manager to place", () => {
    const w = makeWorld();
    const r = submit(w, { title: "Manager harassed me", description: "My supervisor has been harassing me and making threats about my job. " + LONG });
    expect(r.assigneeId).toBeNull();
    const c = getComplaintRow(w.db, w.orgId, r.id)!;
    expect(c.sensitive).toBe(1);
    expect(c.status).toBe("Under Review");
    const note = w.db.prepare("SELECT COUNT(*) n FROM notifications WHERE type = 'unassigned'").get() as any;
    expect(note.n).toBeGreaterThan(0);
    const manager = ctxFor(w, "manager");
    assignComplaint(w.db, manager, r.id, w.users.handler, "Experienced with conduct cases");
    expect(getComplaintRow(w.db, w.orgId, r.id)!.status).toBe("Assigned");
  });

  it("reopening: the complainant can reopen a resolved complaint, and repeated reopening escalates", () => {
    const w = makeWorld();
    const r = submit(w);
    const manager = ctxFor(w, "manager", T0);
    const m2 = ctxFor(w, "manager2", T0);
    const reopenAndResolve = (n: number) => {
      const t = T0 + n * DAY;
      transitionComplaint(w.db, manager, r.id, "Investigation in Progress", { now: t });
      const a = proposeResolution(w.db, manager, r.id, "Replaced the part and tested the machine.", t + 1000);
      decideApproval(w.db, m2, a, true, "ok", t + 2000);
    };
    const current = getComplaintRow(w.db, w.orgId, r.id)!.assignee_id;
    transitionComplaint(w.db, manager, r.id, "Under Review", { comment: "back to triage", now: T0 }); // Assigned -> Under Review allowed
    assignComplaint(w.db, manager, r.id, current === w.users.handler ? w.users.handler2 : w.users.handler, "retriage", T0);
    reopenAndResolve(1);
    const access = () => verifyAccess(w.db, r.ref, r.accessCode, "2.2.2.2", T0 + 10 * DAY);
    complainantReopen(w.db, access(), "Still jamming", T0 + 2 * DAY);
    expect(getComplaintRow(w.db, w.orgId, r.id)!.status).toBe("Reopened");
    reopenAndResolve(3);
    complainantReopen(w.db, access(), "Broke again", T0 + 4 * DAY);
    expect(getComplaintRow(w.db, w.orgId, r.id)!.reopen_count).toBe(2);
    runSlaSweep(w.db, T0 + 4 * DAY + 1000);
    expect(w.db.prepare("SELECT COUNT(*) n FROM escalations WHERE complaint_id = ? AND rule_key = 'repeatedly_reopened'").get(r.id)).toEqual({ n: 1 });
  });

  it("optimistic concurrency: a stale update is refused", () => {
    const w = makeWorld();
    const r = submit(w);
    const manager = ctxFor(w, "manager");
    const v = getComplaintRow(w.db, w.orgId, r.id)!.version;
    transitionComplaint(w.db, manager, r.id, "Investigation in Progress", { expectedVersion: v });
    expect(() => transitionComplaint(w.db, manager, r.id, "Awaiting Internal Department", { expectedVersion: v, comment: "waiting on IT" })).toThrow(/changed/);
  });
});

describe("portal privacy", () => {
  it("reveals nothing without the access code and never exposes internal notes", () => {
    const w = makeWorld();
    const r = submit(w);
    const manager = ctxFor(w, "manager");
    addInternalNote(w.db, manager, r.id, "SECRET internal opinion about the customer");
    sendMessage(w.db, manager, r.id, "We are investigating.");
    expect(() => verifyAccess(w.db, r.ref, "AAAA-BBBB-CCCC", "3.3.3.3")).toThrow(/could not find/);
    expect(() => verifyAccess(w.db, "CMP-2026-999999", r.accessCode, "3.3.3.3")).toThrow(/could not find/);
    const view = publicView(w.db, verifyAccess(w.db, r.ref, r.accessCode, "3.3.3.3"));
    const json = JSON.stringify(view);
    expect(json).not.toContain("SECRET");
    expect(json).not.toContain("Hal Handler");
    expect(view.events.some((e) => e.body === "We are investigating.")).toBe(true);
  });

  it("rate limits guessing", () => {
    const w = makeWorld();
    const r = submit(w);
    let blocked = false;
    for (let i = 0; i < 15; i++) {
      try { verifyAccess(w.db, r.ref, `WRNG-${i}AAA-BBBB`, "9.9.9.9"); } catch (e: any) { if (e.status === 429) blocked = true; }
    }
    expect(blocked).toBe(true);
  });

  it("supports anonymous complaints without storing contact details", () => {
    const w = makeWorld();
    const r = submit(w, { anonymous: true, name: "Should Not Be Stored", email: "x@example.com" });
    const c = getComplaintRow(w.db, w.orgId, r.id)!;
    expect(c.complainant_name).toBeNull();
    expect(c.complainant_email).toBeNull();
    expect(c.contact_method).toBe("none");
    expect(w.db.prepare("SELECT COUNT(*) n FROM outbox WHERE complaint_id = ? AND status = 'pending'").get(r.id)).toEqual({ n: 0 });
    // still trackable with the code
    expect(publicView(w.db, verifyAccess(w.db, r.ref, r.accessCode, "4.4.4.4")).title).toBe("Copier keeps jamming");
  });

  it("collects feedback once", () => {
    const w = makeWorld();
    const r = submit(w);
    const m = ctxFor(w, "manager", T0), m2 = ctxFor(w, "manager2", T0);
    transitionComplaint(w.db, m, r.id, "Investigation in Progress", { now: T0 });
    const a = proposeResolution(w.db, m, r.id, "Replaced the part for good.", T0 + 1);
    decideApproval(w.db, m2, a, true, "ok", T0 + 2);
    const c = verifyAccess(w.db, r.ref, r.accessCode, "5.5.5.5", T0 + 3);
    complainantFeedback(w.db, c, 4, "Fast and polite", T0 + 3);
    expect(() => complainantFeedback(w.db, c, 5, "", T0 + 4)).toThrow(/already/);
    expect(() => complainantFeedback(w.db, c, 9, "")).toThrow(HttpError);
  });
});

describe("access control", () => {
  it("handlers see only their own complaints and other tenants see nothing", () => {
    const a = makeWorld({ slug: "alpha" });
    const b = makeWorld({ slug: "beta", db: a.db });
    const r1 = submit(a);
    const r2 = submitComplaint(a.db, a.orgId, { title: "Another issue entirely", description: LONG + " Different branch.", name: "Pat", email: "pat@example.com", consent: true, now: T0 + 1000 });
    const hand = (r1.assigneeId === a.users.handler) ? "handler" : "handler2";
    const handlerCtx = ctxFor(a, hand);
    const mine = listComplaints(a.db, handlerCtx).items.map((i) => i.id);
    expect(mine).toContain(r1.id);
    for (const id of mine) expect(getComplaintRow(a.db, a.orgId, id)!.assignee_id).toBe(handlerCtx.userId);
    const other = [r1, r2].find((r) => r.assigneeId !== handlerCtx.userId)!;
    expect(() => getComplaintDetail(a.db, handlerCtx, other.id)).toThrow(/not found/);
    // another tenant's manager cannot read or list
    const betaMgr = ctxFor(b, "manager");
    expect(() => getComplaintDetail(a.db, betaMgr, r1.id)).toThrow(/not found/);
    expect(listComplaints(a.db, betaMgr).total).toBe(0);
  });

  it("auditors are read-only", () => {
    const w = makeWorld();
    const r = submit(w);
    const auditor = ctxFor(w, "auditor");
    expect(getComplaintDetail(w.db, auditor, r.id).complaint.ref).toBe(r.ref);
    expect(() => transitionComplaint(w.db, auditor, r.id, "Investigation in Progress")).toThrow(/permission/);
    expect(() => assignComplaint(w.db, auditor, r.id, w.users.handler, "x")).toThrow(HttpError);
    expect(() => addInternalNote(w.db, auditor, r.id, "hello")).toThrow(HttpError);
    expect(() => sendMessage(w.db, auditor, r.id, "hello")).toThrow(HttpError);
  });

  it("complainants with accounts see only their own and no internal data", () => {
    const w = makeWorld();
    const mine = submitComplaint(w.db, w.orgId, { title: "My own problem here", description: LONG, consent: true, complainantUserId: w.users.customer, name: "Casey", email: "customer@acme.test", now: T0 });
    const other = submit(w);
    const manager = ctxFor(w, "manager");
    addInternalNote(w.db, manager, mine.id, "INTERNAL ONLY");
    const customer = ctxFor(w, "customer");
    const list = listComplaints(w.db, customer);
    expect(list.items.map((i) => i.id)).toEqual([mine.id]);
    const d = getComplaintDetail(w.db, customer, mine.id);
    expect(JSON.stringify(d)).not.toContain("INTERNAL ONLY");
    expect(d.tasks).toBeUndefined();
    expect(() => getComplaintDetail(w.db, customer, other.id)).toThrow(/not found/);
    expect(() => transitionComplaint(w.db, customer, mine.id, "Closed")).toThrow(HttpError);
  });

  it("prevents self-handling conflicts and cross-org assignment", () => {
    const w = makeWorld();
    const hu = addUser(w.db, w.orgId, w.roleIds.handler, "h3@acme.test", "Self Handler");
    const r = submitComplaint(w.db, w.orgId, { title: "Complaint about my team", description: LONG, consent: true, complainantUserId: hu, name: "Self", email: "h3@acme.test", now: T0 });
    const manager = ctxFor(w, "manager");
    expect(() => assignComplaint(w.db, manager, r.id, hu, "x")).toThrow(/Conflict of interest/);
    const o = makeWorld({ slug: "other", db: w.db });
    expect(() => assignComplaint(w.db, manager, r.id, o.users.handler, "x")).toThrow(/cannot be assigned/);
  });
});

describe("nothing internal reaches the complainant", () => {
  it("keeps proposed resolutions and staff comments out of the public timeline until approved or explicitly shared", () => {
    const w = makeWorld();
    const r = submit(w);
    const m = ctxFor(w, "manager", T0), m2 = ctxFor(w, "manager2", T0);
    transitionComplaint(w.db, m, r.id, "Investigation in Progress", { comment: "PRIVATE-REASON customer is difficult", now: T0 + 1 });
    const a = proposeResolution(w.db, m, r.id, "UNAPPROVED-OUTCOME refund everything", T0 + 2);
    const access = () => verifyAccess(w.db, r.ref, r.accessCode, "6.6.6.6", T0 + 10);
    let json = JSON.stringify(publicView(w.db, access()));
    expect(json).not.toContain("PRIVATE-REASON");
    expect(json).not.toContain("UNAPPROVED-OUTCOME");
    expect(publicView(w.db, access()).resolution).toBeNull();
    decideApproval(w.db, m2, a, true, "INTERNAL-APPROVAL-NOTE", T0 + 3);
    json = JSON.stringify(publicView(w.db, access()));
    expect(json).not.toContain("INTERNAL-APPROVAL-NOTE");
    expect(publicView(w.db, access()).resolution).toContain("UNAPPROVED-OUTCOME"); // visible only once approved
    // the staff view still has the internal comment
    expect(JSON.stringify(getComplaintDetail(w.db, m, r.id).events)).toContain("PRIVATE-REASON");
  });
  it("shows a rejection reason to the complainant on purpose", () => {
    const w = makeWorld();
    const r = submit(w);
    const m = ctxFor(w, "manager");
    transitionComplaint(w.db, m, r.id, "Under Review", { comment: "Re-triage: may be out of scope" });
    transitionComplaint(w.db, m, r.id, "Rejected", { comment: "This is outside our scope; please contact the regulator." });
    expect(JSON.stringify(publicView(w.db, verifyAccess(w.db, r.ref, r.accessCode, "7.7.7.7")))).toContain("outside our scope");
  });
});
