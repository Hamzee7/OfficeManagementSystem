/**
 * Fill a SEPARATE demo organization with clearly labelled sample people and complaints so you can explore the app.
 * Everything is created through the same service functions the app uses. Do not run against a live database you care about
 * unless you are happy to have a "Demo Organization (sample data)" workspace in it.
 *   npm run seed:demo
 */
import { getDb, newId } from "../src/server/db";
import { createOrganization } from "../src/server/org";
import { hashPassword, authenticate, login } from "../src/server/auth";
import { submitComplaint, transitionComplaint, proposeResolution, decideApproval, addInternalNote, sendMessage, assignComplaint } from "../src/server/complaints";
import { runSlaSweep } from "../src/server/escalate";
import { saveArticle } from "../src/server/admin";

const PASSWORD = "Demo-Passw0rd!";
const db = getDb();
if (db.prepare("SELECT 1 FROM organizations WHERE slug = 'demo'").get()) { console.log("Demo organization already exists. Nothing to do."); process.exit(0); }

const DAY = 86_400_000;
const now = Date.now();
const { orgId, roleIds } = createOrganization(db, { name: "Demo Organization (sample data)", slug: "demo", timezone: "Asia/Karachi", workDays: [1, 2, 3, 4, 5, 6] });
const hash = hashPassword(PASSWORD);
const dept = (db.prepare("SELECT id FROM departments WHERE org_id = ?").get(orgId) as { id: string }).id;
for (const n of ["Head Office", "Karachi Branch", "Lahore Branch"]) db.prepare("INSERT INTO locations (id, org_id, name) VALUES (?,?,?)").run(newId(), orgId, n);
db.prepare("INSERT INTO departments (id, org_id, name, created_at) VALUES (?,?,?,?)").run(newId(), orgId, "Technical Service", now);
const mk = (role: string, email: string, name: string) => { const id = newId(); db.prepare("INSERT INTO users (id, org_id, email, name, password_hash, role_id, department_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(id, orgId, email, name, hash, roleIds[role], dept, now, now); return id; };
mk("org_admin", "admin@demo.test", "Demo Admin"); mk("manager", "manager@demo.test", "Demo Manager"); mk("manager", "manager2@demo.test", "Demo Manager Two");
const h1 = mk("handler", "handler@demo.test", "Demo Handler"); const h2 = mk("handler", "handler2@demo.test", "Demo Handler Two"); mk("auditor", "auditor@demo.test", "Demo Auditor");
const ctx = (email: string, at: number) => { const r = login(db, email, PASSWORD, { ip: "seed", now: at }); if (!r.ok) throw new Error(r.error); return authenticate(db, r.token, at)!; };

const samples: [string, string, number, string?][] = [
  ["Printer keeps jamming after service", "The printer on the second floor has jammed repeatedly since the engineer visited last week and we cannot print the monthly statements.", 12],
  ["Invoice shows toner we never received", "Invoice 4471 lists four toner cartridges but only two were delivered. Please correct the invoice and confirm the credit note.", 9],
  ["Delivery arrived two days late", "The machine was promised for Monday morning and only arrived on Wednesday afternoon, which delayed our branch opening.", 6],
  ["Engineer was rude during visit", "The visiting engineer was dismissive and unprofessional with our staff and left the work area untidy.", 5],
  ["Faded lines on bulk print job", "The 5,000 page report has faded lines from page 1,200 onward. We need the affected pages reprinted at no charge.", 4],
  ["Wrong paper size supplied", "We ordered A3 paper for the plotter but A4 was delivered. This is the second time this has happened.", 3],
  ["Air conditioning broken in workshop", "The workshop air conditioning has been off for three days and the temperature is unsafe for staff to work in.", 2],
  ["Copier error code E-402 every morning", "Each morning the copier shows error E-402 and needs a restart. It then works for a few hours before failing again.", 2],
  ["No reply to my support email", "I emailed support a week ago about a billing mistake and have had no answer at all, not even an acknowledgment.", 8],
  ["Charged twice for the same service call", "My account shows two charges for the same service call on the same date. Please refund the duplicate payment.", 1],
];
let created = 0;
for (const [i, [title, description, daysAgo]] of samples.entries()) {
  const at = now - daysAgo * DAY + i * 600_000;
  const r = submitComplaint(db, orgId, { title, description, name: `Sample Customer ${i + 1}`, email: `customer${i + 1}@example.test`, consent: true, now: at });
  created++;
  const mgr = ctx("manager@demo.test", at + 1000), mgr2 = ctx("manager2@demo.test", at + 1000);
  if (!r.assigneeId) assignComplaint(db, mgr, r.id, i % 2 ? h1 : h2, "Demo assignment", at + 2000);
  const step = i % 5;
  if (step >= 1) {
    const handlerEmail = (db.prepare("SELECT u.email FROM complaints c JOIN users u ON u.id = c.assignee_id WHERE c.id = ?").get(r.id) as { email: string }).email;
    const h = ctx(handlerEmail, at + 3000);
    transitionComplaint(db, h, r.id, "Investigation in Progress", { now: at + 3600_000 });
    addInternalNote(db, h, r.id, "Demo note: reviewed the history and contacted the customer.", at + 3 * 3600_000);
    sendMessage(db, h, r.id, "Thank you for your patience. We are looking into this and will update you shortly.", "update", at + 4 * 3600_000);
    if (step >= 3) {
      const a = proposeResolution(db, h, r.id, "Demo outcome: the issue was investigated, corrected and the customer was informed.", at + DAY);
      if (step === 4) decideApproval(db, mgr2, a, true, "Approved (demo)", at + DAY + 3600_000);
    }
  }
}
saveArticle(db, ctx("manager@demo.test", now), { title: "Refund policy for duplicate charges", body: "Duplicate charges are refunded within 5 working days once the second payment is verified against the bank statement. Always confirm the invoice number first.", tags: [], published: true });
const sweep = runSlaSweep(db, now);
console.log(`Demo organization created with ${created} sample complaints and ${sweep.created} automatic escalations.`);
console.log(`Sign in at /login with any of: admin@demo.test, manager@demo.test, handler@demo.test, auditor@demo.test  (password: ${PASSWORD})`);
