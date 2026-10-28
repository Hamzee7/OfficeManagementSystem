import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeWorld, ctxFor, LONG, addUser, PASSWORD } from "./helpers";
import { submitComplaint, listComplaints, transitionComplaint, getComplaintRow, proposeResolution, decideApproval, getComplaintDetail } from "@/server/complaints";
import { audit, verifyAuditChain } from "@/server/audit";
import { login, authenticate, logout, HttpError } from "@/server/auth";
import { saveAttachment, uploadAsStaff, readAttachmentForUser, MAX_UPLOAD_BYTES } from "@/server/storage";
import { dashboard, exportComplaintsCsv } from "@/server/reports";
import { deliverOutbox, queueEmail, type MailTransport } from "@/server/notify";
import { applyRetention } from "@/server/escalate";
import { createUser, saveCategory, saveOrgSettings, updateUser, saveTransition } from "@/server/admin";
import { assist } from "@/server/ai";
import { newId } from "@/server/db";
import { allow } from "@/server/ratelimit";

const DAY = 86_400_000;
const T0 = Date.parse("2026-03-02T09:00:00Z");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

let tmp: string;
beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cms-test-")); process.env.STORAGE_DIR = tmp; });
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const sub = (w: ReturnType<typeof makeWorld>, extra: object = {}, now = T0) =>
  submitComplaint(w.db, w.orgId, { title: "Copier keeps jamming", description: LONG, name: "Sam", email: "sam@example.com", consent: true, now, ...extra });

describe("audit trail", () => {
  it("is hash-chained, detects tampering and refuses edits and deletes", () => {
    const w = makeWorld();
    sub(w);
    audit(w.db, { orgId: w.orgId, action: "test.event", data: { a: 1 } });
    expect(verifyAuditChain(w.db)).toMatchObject({ ok: true });
    expect(() => w.db.prepare("UPDATE audit_events SET action = 'x' WHERE seq = 1").run()).toThrow(/append-only/);
    expect(() => w.db.prepare("DELETE FROM audit_events WHERE seq = 1").run()).toThrow(/append-only/);
    expect(() => w.db.prepare("DELETE FROM complaint_events").run()).toThrow(/append-only/);
    // tamper behind the triggers' back (as a database admin could) and the chain must break
    w.db.exec("DROP TRIGGER audit_events_no_update");
    w.db.prepare("UPDATE audit_events SET action = 'forged' WHERE seq = 2").run();
    const v = verifyAuditChain(w.db);
    expect(v.ok).toBe(false);
    expect(v.brokenAtSeq).toBe(2);
  });
  it("never records passwords", () => {
    const w = makeWorld();
    login(w.db, "admin@acme.test", PASSWORD);
    login(w.db, "admin@acme.test", "wrong-password");
    const all = JSON.stringify(w.db.prepare("SELECT * FROM audit_events").all());
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain("wrong-password");
  });
});

describe("authentication", () => {
  it("locks the account after repeated failures and expires sessions", () => {
    const w = makeWorld();
    for (let i = 0; i < 5; i++) expect(login(w.db, "handler@acme.test", "nope" + i, { ip: "7.7.7.7", now: T0 }).ok).toBe(false);
    const locked = login(w.db, "handler@acme.test", PASSWORD, { ip: "7.7.7.8", now: T0 + 1000 });
    expect(locked.ok).toBe(false);
    expect((locked as any).error).toMatch(/locked/);
    const later = login(w.db, "handler@acme.test", PASSWORD, { ip: "7.7.7.9", now: T0 + 16 * 60_000 });
    expect(later.ok).toBe(true);
    const tok = (later as any).token;
    expect(authenticate(w.db, tok, T0 + 16 * 60_000 + 1000)).not.toBeNull();
    expect(authenticate(w.db, tok, T0 + 16 * 60_000 + 3 * 3600_000)).toBeNull(); // idle timeout
    expect(authenticate(w.db, "not-a-token")).toBeNull();
  });
  it("gives the same answer for unknown users and wrong passwords", () => {
    const w = makeWorld();
    const a = login(w.db, "ghost@acme.test", "whatever12345", { ip: "8.8.8.1" });
    const b = login(w.db, "admin@acme.test", "whatever12345", { ip: "8.8.8.2" });
    expect(a).toEqual(b);
  });
  it("deactivating a user ends their sessions immediately", () => {
    const w = makeWorld();
    const admin = ctxFor(w, "admin");
    const h = ctxFor(w, "handler");
    updateUser(w.db, admin, w.users.handler, { isActive: false });
    expect(authenticate(w.db, "irrelevant")).toBeNull();
    const row = w.db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id = ?").get(h.userId) as any;
    expect(row.n).toBe(0);
    expect(login(w.db, "handler@acme.test", PASSWORD).ok).toBe(false);
  });
  it("logout destroys the session", () => {
    const w = makeWorld();
    const r = login(w.db, "admin@acme.test", PASSWORD) as any;
    expect(authenticate(w.db, r.token)).not.toBeNull();
    logout(w.db, r.token);
    expect(authenticate(w.db, r.token)).toBeNull();
  });
  it("rate limiter blocks after the limit and recovers next window", () => {
    const w = makeWorld();
    for (let i = 0; i < 3; i++) expect(allow(w.db, "k", 3, 1000, 5000)).toBe(true);
    expect(allow(w.db, "k", 3, 1000, 5500)).toBe(false);
    expect(allow(w.db, "k", 3, 1000, 6500)).toBe(true);
  });
});

describe("user and role administration", () => {
  it("only user managers can create users; weak passwords and duplicate emails are refused; privilege escalation is blocked", () => {
    const w = makeWorld();
    const handler = ctxFor(w, "handler");
    const admin = ctxFor(w, "admin");
    expect(() => createUser(w.db, handler, { email: "x@acme.test", name: "X Y", password: PASSWORD, roleId: w.roleIds.handler })).toThrow(/permission/);
    expect(() => createUser(w.db, admin, { email: "x@acme.test", name: "X Y", password: "short", roleId: w.roleIds.handler })).toThrow(/10 characters/);
    expect(() => createUser(w.db, admin, { email: "handler@acme.test", name: "Dup", password: PASSWORD, roleId: w.roleIds.handler })).toThrow(/already exists/);
    expect(() => createUser(w.db, admin, { email: "su@acme.test", name: "Super", password: PASSWORD, roleId: w.roleIds.super_admin })).toThrow(/platform administrator/);
    expect(() => updateUser(w.db, admin, w.users.admin, { isActive: false })).toThrow(/yourself/);
    expect(createUser(w.db, admin, { email: "new@acme.test", name: "New Person", password: PASSWORD, roleId: w.roleIds.handler })).toBeTruthy();
  });
  it("workflow settings cannot disable the approval gate", () => {
    const w = makeWorld();
    const admin = ctxFor(w, "admin");
    expect(() => saveTransition(w.db, admin, { from: "Pending Approval", to: "Resolved", requiresComment: false, requiresEvidence: false, enabled: false })).toThrow(/cannot be disabled/);
    saveTransition(w.db, admin, { from: "Resolution Proposed", to: "Pending Approval", requiresComment: true, requiresEvidence: true, enabled: true });
  });
  it("org configuration is validated", () => {
    const w = makeWorld();
    const admin = ctxFor(w, "admin");
    expect(() => saveOrgSettings(w.db, admin, { timezone: "Mars/Olympus" })).toThrow(/time zone/);
    expect(() => saveOrgSettings(w.db, admin, { workStart: "18:00", workEnd: "09:00" })).toThrow(/after opening/);
    expect(() => saveCategory(w.db, admin, { name: "Bad SLA", ackMinutes: 500, firstResponseMinutes: 100, resolutionMinutes: 900 })).toThrow(/increase/);
    saveOrgSettings(w.db, admin, { timezone: "Asia/Karachi", workDays: [1, 2, 3, 4, 5, 6], workStart: "10:00", workEnd: "18:00" });
  });
});

describe("evidence uploads", () => {
  it("accepts real images, rejects disguised files, oversize files and path tricks", () => {
    const w = makeWorld();
    const r = sub(w);
    const m = ctxFor(w, "manager");
    expect(uploadAsStaff(w.db, m, r.id, "photo.png", PNG, "internal").id).toBeTruthy();
    expect(() => uploadAsStaff(w.db, m, r.id, "evil.png", Buffer.from("MZ\x90\x00 this is an exe"), "internal")).toThrow(/not allowed/);
    expect(() => uploadAsStaff(w.db, m, r.id, "run.exe", PNG, "internal")).toThrow(/not allowed/);
    expect(() => uploadAsStaff(w.db, m, r.id, "page.html", Buffer.from("<script>alert(1)</script>"), "internal")).toThrow(/not allowed/);
    expect(() => saveAttachment(w.db, { orgId: w.orgId, complaintId: r.id, filename: "big.pdf", data: Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(MAX_UPLOAD_BYTES)]), uploader: { kind: "complainant" }, visibility: "public" })).toThrow(/at most/);
    const id = uploadAsStaff(w.db, m, r.id, "../../etc/passwd.png", PNG, "internal").id;
    const row = w.db.prepare("SELECT filename, storage_key FROM attachments WHERE id = ?").get(id) as any;
    expect(row.filename).not.toContain("/");
    expect(fs.existsSync(path.join(tmp, row.storage_key))).toBe(true);
  });
  it("internal evidence is invisible to complainants; downloads are permission-checked and audited", () => {
    const w = makeWorld();
    const mine = submitComplaint(w.db, w.orgId, { title: "Problem with my account", description: LONG, consent: true, complainantUserId: w.users.customer, name: "Casey", email: "customer@acme.test", now: T0 });
    const m = ctxFor(w, "manager");
    const internal = uploadAsStaff(w.db, m, mine.id, "internal.png", PNG, "internal").id;
    const pub = uploadAsStaff(w.db, m, mine.id, "public.png", PNG, "public").id;
    const customer = ctxFor(w, "customer");
    expect(() => readAttachmentForUser(w.db, customer, internal)).toThrow(/not found/);
    expect(readAttachmentForUser(w.db, customer, pub).mime).toBe("image/png");
    expect(getComplaintDetail(w.db, customer, mine.id).attachments.map((a: any) => a.id)).toEqual([pub]);
    const other = sub(w);
    const otherAtt = uploadAsStaff(w.db, m, other.id, "x.png", PNG, "public").id;
    expect(() => readAttachmentForUser(w.db, customer, otherAtt)).toThrow(/not found/);
    expect((w.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action = 'attachment.downloaded'").get() as any).n).toBe(1);
  });
});

describe("outbox", () => {
  const failing: MailTransport = { name: "fail", send: async () => { throw new Error("SMTP down"); } };
  const ok: MailTransport & { sent: string[] } = { name: "test", sent: [], async send(m) { this.sent.push(m.to); } };
  it("queues once, retries with back-off, and gives up visibly", async () => {
    const w = makeWorld();
    const base = { orgId: w.orgId, to: "a@example.com", template: "update", vars: { ref: "R", message: "m", org: "o", name: "n", trackUrl: "u" }, key: "k" };
    expect(queueEmail(w.db, { ...base, now: T0 })).toBe(true);
    expect(queueEmail(w.db, { ...base, now: T0 })).toBe(false); // duplicate prevented
    let t = T0;
    for (let i = 0; i < 5; i++) { await deliverOutbox(w.db, failing, t); t += 2 ** (i + 1) * 60_000 + 1; }
    const row = w.db.prepare("SELECT status, attempts, last_error FROM outbox").get() as any;
    expect(row).toMatchObject({ status: "failed", attempts: 5, last_error: "SMTP down" });
  });
  it("sends successfully and not twice", async () => {
    const w = makeWorld();
    queueEmail(w.db, { orgId: w.orgId, to: "b@example.com", template: "update", vars: {}, key: "x", now: T0 });
    expect((await deliverOutbox(w.db, ok, T0)).sent).toBe(1);
    expect((await deliverOutbox(w.db, ok, T0 + 1)).sent).toBe(0);
    expect(ok.sent).toEqual(["b@example.com"]);
  });
  it("records a skipped message when there is no address", () => {
    const w = makeWorld();
    queueEmail(w.db, { orgId: w.orgId, to: null, template: "update", vars: {}, key: "x" });
    expect(w.db.prepare("SELECT status FROM outbox").get()).toEqual({ status: "skipped" });
  });
});

describe("reports", () => {
  function seed() {
    const w = makeWorld();
    const mgr = ctxFor(w, "manager", T0), mgr2 = ctxFor(w, "manager2", T0);
    const ids: string[] = [];
    // 4 created on Mar 2 (Mon); 2 resolved on time on Mar 3; 1 resolved late on Mar 20
    for (let i = 0; i < 4; i++) ids.push(sub(w, { title: `Copier jam number ${i} at branch`, description: LONG + ` unique${i}` }, T0 + i * 60_000).id);
    const resolve = (id: string, at: number) => {
      transitionComplaint(w.db, mgr, id, "Investigation in Progress", { now: at - 3000 });
      const a = proposeResolution(w.db, mgr, id, "Fixed the paper path and tested it.", at - 2000);
      decideApproval(w.db, mgr2, a, true, "ok", at);
    };
    resolve(ids[0], T0 + DAY); resolve(ids[1], T0 + DAY + 3600_000); resolve(ids[2], T0 + 18 * DAY);
    return { w, ids, mgr, mgr2 };
  }
  it("computes KPIs from real records with the documented definitions", () => {
    const { w, mgr } = seed();
    const d = dashboard(w.db, mgr, { from: Date.parse("2026-03-01T00:00:00Z"), to: Date.parse("2026-04-01T00:00:00Z") }, Date.parse("2026-03-25T00:00:00Z"));
    expect(d.kpis.created).toBe(4);
    expect(d.kpis.resolved).toBe(3);
    expect(d.kpis.openNow).toBe(1);
    expect(d.kpis.overdueNow).toBe(1); // the unresolved one is long past its deadline
    expect(d.kpis.slaCompliance).toBe(67); // 2 of 3 resolved on time
    expect(d.kpis.avgResolutionMinutes).toBeGreaterThan(0);
    expect(d.volume.reduce((s, v) => s + v.created, 0)).toBe(4);
    expect(d.volume.reduce((s, v) => s + v.resolved, 0)).toBe(3);
    expect(d.definitions.created).toMatch(/creation|created/i);
    // created and resolved are different sets: a March-only window for April sees none created
    const april = dashboard(w.db, mgr, { from: Date.parse("2026-04-01T00:00:00Z"), to: Date.parse("2026-05-01T00:00:00Z") });
    expect(april.kpis.created).toBe(0);
    expect(april.kpis.slaCompliance).toBeNull(); // n/a, not 0% or 100%
    expect(april.kpis.csat).toBeNull();
    expect(d.themes.some((t) => t.label === "copier")).toBe(true);
  });
  it("respects permissions and row-level scope", () => {
    const { w } = seed();
    const handler = ctxFor(w, "handler"), customer = ctxFor(w, "customer"), auditor = ctxFor(w, "auditor");
    const range = { from: Date.parse("2026-03-01T00:00:00Z"), to: Date.parse("2026-04-01T00:00:00Z") };
    expect(() => dashboard(w.db, handler, range)).toThrow(/permission/);
    expect(() => dashboard(w.db, customer, range)).toThrow(/permission/);
    expect(dashboard(w.db, auditor, range).kpis.created).toBe(4);
    expect(() => dashboard(w.db, auditor, { from: range.to, to: range.from })).toThrow(/after/);
  });
  it("exports CSV with PII only for authorised users, neutralises formulas, audits the export", () => {
    const { w } = seed();
    sub(w, { title: "=HYPERLINK(\"http://evil\") formula title" }, T0 + 10 * DAY);
    const mgr = ctxFor(w, "manager"), auditor = ctxFor(w, "auditor"), handler = ctxFor(w, "handler");
    const m = exportComplaintsCsv(w.db, mgr, {});
    expect(m.csv.split("\n")[0]).toContain("Email");
    expect(m.csv).toContain("sam@example.com");
    expect(m.csv).toContain("'=HYPERLINK");
    const a = exportComplaintsCsv(w.db, auditor, {});
    expect(a.csv).not.toContain("sam@example.com");
    expect(a.csv.split("\n")[0]).not.toContain("Email");
    expect(() => exportComplaintsCsv(w.db, handler, {})).toThrow(/permission/);
    expect((w.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action = 'report.exported'").get() as any).n).toBe(2);
  });
});

describe("data protection", () => {
  it("strips complainant personal data after the retention period but keeps the case", () => {
    const w = makeWorld();
    const mgr = ctxFor(w, "manager", T0), mgr2 = ctxFor(w, "manager2", T0);
    const r = sub(w);
    transitionComplaint(w.db, mgr, r.id, "Investigation in Progress", { now: T0 + 1 });
    const a = proposeResolution(w.db, mgr, r.id, "All sorted out and tested.", T0 + 2);
    decideApproval(w.db, mgr2, a, true, "ok", T0 + 3);
    transitionComplaint(w.db, mgr, r.id, "Closed", { now: T0 + 4 });
    expect(applyRetention(w.db, w.orgId, T0 + 100 * DAY)).toBe(0);
    expect(applyRetention(w.db, w.orgId, T0 + 3000 * DAY)).toBe(1);
    const c = getComplaintRow(w.db, w.orgId, r.id)!;
    expect(c.complainant_email).toBeNull();
    expect(c.title).toBe("Copier keeps jamming");
  });
  it("lists never return other people's personal details to roles without that permission", () => {
    const w = makeWorld();
    sub(w);
    const auditor = ctxFor(w, "auditor");
    const item = listComplaints(w.db, auditor).items[0];
    expect(item.complainant_email).toBeNull();
    expect(item.complainant_name).toBeNull();
  });
});

describe("AI assistance", () => {
  it("only suggests; records what it produced; respects the organization switch", () => {
    const w = makeWorld();
    const r = sub(w);
    const mgr = ctxFor(w, "manager");
    const before = getComplaintRow(w.db, w.orgId, r.id)!;
    const draft = assist(w.db, mgr, r.id, "draft_update") as any;
    expect(draft.text).toContain(before.ref);
    expect(draft.note).toMatch(/review/i);
    expect(getComplaintRow(w.db, w.orgId, r.id)!.status).toBe(before.status); // nothing changed
    expect((w.db.prepare("SELECT COUNT(*) n FROM ai_recommendations WHERE kind = 'draft_update'").get() as any).n).toBe(1);
    const admin = ctxFor(w, "admin");
    saveOrgSettings(w.db, admin, { aiEnabled: false });
    expect(() => assist(w.db, mgr, r.id, "summary")).toThrow(/turned off/);
    const handlerNoAi = ctxFor(w, "auditor");
    expect(() => assist(w.db, handlerNoAi, r.id, "summary")).toThrow(HttpError);
  });
  it("flags safety and conduct language for human review and never rejects a complaint by itself", () => {
    const w = makeWorld();
    const r = submit();
    function submit() { return sub(w, { title: "Threats from a colleague", description: "I am being threatened and harassed by a colleague. " + LONG }); }
    const c = getComplaintRow(w.db, w.orgId, r.id)!;
    expect(c.sensitive).toBe(1);
    expect(c.status).not.toBe("Rejected");
    const rec = w.db.prepare("SELECT payload FROM ai_recommendations WHERE complaint_id = ? AND kind = 'priority'").get(r.id) as any;
    expect(JSON.parse(rec.payload).flagForHumanReview).toBe(true);
  });
});

describe("scale", () => {
  it("lists, searches and aggregates 20,000 complaints quickly", () => {
    const w = makeWorld();
    const mgr = ctxFor(w, "manager");
    const cat = (w.db.prepare("SELECT id FROM categories WHERE org_id = ? LIMIT 1").get(w.orgId) as any).id;
    const ins = w.db.prepare(`INSERT INTO complaints (id, org_id, ref, title, description, category_id, priority, status, access_code_hash, created_at, updated_at, resolved_at, resolution_due_at, sla_total_minutes, assignee_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const statuses = ["Submitted", "Assigned", "Investigation in Progress", "Resolved", "Closed"];
    w.db.transaction(() => {
      for (let i = 0; i < 20_000; i++) {
        const created = T0 + (i % 300) * DAY / 10;
        const st = statuses[i % 5];
        ins.run(newId(), w.orgId, `PERF-${i}`, `Perf complaint ${i} printer issue`, "desc", cat, ["Low", "Medium", "High", "Critical"][i % 4], st, "x", created, created, st === "Resolved" || st === "Closed" ? created + DAY : null, created + 5 * DAY, 4800, i % 3 ? w.users.handler : null);
      }
    })();
    let t = performance.now();
    const page = listComplaints(w.db, mgr, { page: 3, pageSize: 25, sort: "due_asc" });
    const tList = performance.now() - t;
    t = performance.now();
    const found = listComplaints(w.db, mgr, { q: "complaint 1999", status: ["Assigned"] });
    const tSearch = performance.now() - t;
    t = performance.now();
    const d = dashboard(w.db, mgr, { from: T0, to: T0 + 400 * DAY }, T0 + 500 * DAY);
    const tDash = performance.now() - t;
    expect(page.total).toBe(20_000);
    expect(found.total).toBeGreaterThan(0);
    expect(d.kpis.created).toBe(20_000);
    console.log(`scale: list ${tList.toFixed(0)}ms, search ${tSearch.toFixed(0)}ms, dashboard ${tDash.toFixed(0)}ms`);
    expect(tList).toBeLessThan(500);
    expect(tSearch).toBeLessThan(800);
    expect(tDash).toBeLessThan(4000);
  });
});

void addUser;
