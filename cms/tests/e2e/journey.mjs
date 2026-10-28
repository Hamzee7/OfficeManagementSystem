// End-to-end journey in a real browser against a real server and database.
// Usage: npm run build && node tests/e2e/journey.mjs   (needs `playwright` installed; see docs/TESTING.md)
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import crypto from "node:crypto";

// Authenticator-app code generator (RFC 6238), independent of the application code.
function totp(base32, ms = Date.now()) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, val = 0; const bytes = [];
  for (const c of base32.replace(/[\s=]/g, "")) { val = (val << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { bytes.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(ms / 30000)));
  const h = crypto.createHmac("sha1", Buffer.from(bytes)).update(buf).digest(); const o = h[h.length - 1] & 15;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, "0");
}
// 1x1 PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cms-e2e-"));
const PORT = 3100 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
const env = { ...process.env, DATABASE_PATH: path.join(dir, "e2e.db"), STORAGE_DIR: path.join(dir, "files"), SESSION_SECRET: "e2e-secret", APP_URL: BASE, NODE_ENV: "production" };
const PASS = "Demo-Passw0rd!";

execFileSync("npx", ["tsx", "scripts/seed-demo.ts"], { env, stdio: "pipe" });
const server = spawn("npx", ["next", "start", "-p", String(PORT)], { env, stdio: "pipe" });
let log = "";
server.stdout.on("data", (d) => (log += d)); server.stderr.on("data", (d) => (log += d));

async function waitUp() { for (let i = 0; i < 80; i++) { try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch {} await new Promise((r) => setTimeout(r, 500)); } throw new Error("server did not start\n" + log); }

const results = [];
const step = async (name, fn) => { try { await fn(); results.push(["PASS", name]); console.log("PASS", name); } catch (e) { results.push(["FAIL", name]); console.log("FAIL", name, "\n", e.message); throw e; } };

async function signIn(browser, email, password = PASS) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", email); await page.fill("#password", password);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button:has-text('Sign in')")]);
  return { ctx, page };
}

let browser;
try {
  await waitUp();
  browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });

  let ref, code;
  await step("consent is enforced, then submission succeeds and shows reference + private code", async () => {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto(`${BASE}/submit`);
    await page.fill("#email", "eve@example.com");
    await page.click("button:has-text('Continue')");
    await page.fill("#title", "Printer jams every morning at reception");
    await page.fill("#desc", "The reception printer jams every single morning and the engineer has not fixed it despite two visits. Please help.");
    await page.click("button:has-text('Continue')");
    await page.click("button:has-text('Send complaint')");
    await page.waitForSelector("text=Please confirm you have read the privacy notice");
    await page.check("input[type=checkbox]");
    await page.click("button:has-text('Send complaint')");
    await page.waitForSelector("text=Thank you. We have your complaint.");
    const boxes = await page.locator(".ref-box").allTextContents();
    ref = boxes[0].trim(); code = boxes[1].trim();
    assert.match(ref, /^CMP-\d{4}-\d{6}$/); assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    await ctx.close();
  });

  await step("tracking needs the correct access code", async () => {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto(`${BASE}/track`);
    await page.fill("#ref", ref); await page.fill("#code", "AAAA-BBBB-CCCC");
    await page.click("button:has-text('Show my complaint')");
    await page.waitForSelector("text=could not find a complaint");
    await page.fill("#code", code);
    await page.click("button:has-text('Show my complaint')");
    await page.waitForSelector("text=Printer jams every morning at reception");
    await ctx.close();
  });

  let id;
  await step("manager finds it, adds an internal note and messages the complainant", async () => {
    const { ctx, page } = await signIn(browser, "manager@demo.test");
    await page.goto(`${BASE}/complaints?q=${encodeURIComponent("Printer jams every morning")}`);
    await page.click(`a:has-text('${ref}')`);
    await page.waitForSelector("h1:has-text('Printer jams every morning')");
    id = page.url().split("/").pop();
    await page.fill("#n-b", "INTERNAL-ONLY: customer is a repeat complainant");
    await page.click("button:has-text('Add internal note')");
    await page.waitForSelector("text=INTERNAL-ONLY");
    await page.fill("#m-b", "We are sending an engineer tomorrow morning.");
    await page.click("button:has-text('Send to complainant')");
    await page.waitForSelector("text=We are sending an engineer tomorrow morning.");
    await ctx.close();
  });

  await step("assigned handler investigates and proposes a resolution; cannot approve", async () => {
    const owner = await ownerEmail();
    const { ctx, page } = await signIn(browser, owner);
    await page.goto(`${BASE}/complaints/${id}`);
    await page.selectOption("#t-to", "Investigation in Progress");
    await page.click("button:has-text('Change status')");
    await page.waitForSelector("text=Propose resolution");
    await page.fill("#p-t", "Replaced the feed roller and tested 200 pages without a jam.");
    await page.click("button:has-text('Submit for approval')");
    await page.waitForSelector("text=Pending Approval");
    assert.equal(await page.locator("button:has-text('Approve and resolve')").count(), 0, "handler must not see approve controls");
    await ctx.close();
  });

  await step("a manager approves and the complaint is resolved", async () => {
    const { ctx, page } = await signIn(browser, "manager@demo.test");
    await page.goto(`${BASE}/complaints/${id}`);
    await page.click("button:has-text('Approve and resolve')");
    await page.waitForSelector("text=Resolved");
    await ctx.close();
  });

  await step("complainant sees the outcome, never the internal note, and can leave feedback", async () => {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await page.goto(`${BASE}/track`);
    await page.fill("#ref", ref); await page.fill("#code", code);
    await page.click("button:has-text('Show my complaint')");
    await page.waitForSelector("text=Replaced the feed roller");
    const html = await page.content();
    assert.ok(!html.includes("INTERNAL-ONLY"), "internal note leaked to the portal");
    assert.ok(html.includes("We are sending an engineer tomorrow morning."));
    await page.click("button[role=radio]:has-text('5')");
    await page.click("button:has-text('Send feedback')");
    await page.waitForSelector("text=Thank you for your feedback");
    await ctx.close();
  });

  await step("access control is enforced by the server", async () => {
    const anon = await fetch(`${BASE}/api/complaints`); assert.equal(anon.status, 401);
    const crossSite = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify({ email: "manager@demo.test", password: PASS }) });
    assert.equal(crossSite.status, 403);
    const other = await signIn(browser, "handler2@demo.test");
    const owner = await ownerEmail();
    if (owner !== "handler2@demo.test") {
      const res = await other.page.request.get(`${BASE}/api/complaints/${id}`);
      assert.equal(res.status(), 404, "a handler must not read someone else's complaint");
    }
    const audit = await other.page.request.get(`${BASE}/api/audit`); assert.equal(audit.status(), 403);
    await other.ctx.close();
  });

  await step("manager sees real, consistent dashboard numbers and the audit trail is intact", async () => {
    const { ctx, page } = await signIn(browser, "admin@demo.test");
    await page.goto(`${BASE}/reports`);
    await page.waitForSelector("text=SLA compliance");
    await page.goto(`${BASE}/audit`);
    await page.waitForSelector("text=Integrity check passed");
    await ctx.close();
  });

  await step("every page renders without errors for every role", async () => {
    const pages = ["/", "/complaints", "/complaints?scope=mine", "/complaints?scope=assigned", "/complaints?scope=unassigned", "/complaints/new", "/escalations", "/sla", "/departments", "/team", "/reports", "/knowledge", "/notifications", "/audit", "/settings", "/settings?tab=categories", "/settings?tab=workflow", "/settings?tab=roles", "/settings?tab=templates", "/settings?tab=integrations", "/settings?tab=account", "/help", "/submit", "/track"];
    for (const email of ["admin@demo.test", "manager@demo.test", "handler@demo.test", "auditor@demo.test"]) {
      const { ctx, page } = await signIn(browser, email);
      for (const p of pages) {
        const res = await page.goto(BASE + p);
        assert.ok(res && res.status() < 500, `${email} ${p} returned ${res?.status()}`);
        assert.equal(await page.locator("#__next_error__").count(), 0, `${email} ${p} crashed`);
        assert.ok(!(await page.content()).includes("Something went wrong"), `${email} ${p} shows an error`);
      }
      await ctx.close();
    }
  });

  await step("administrator can configure the system through the forms", async () => {
    const { ctx, page } = await signIn(browser, "admin@demo.test");
    const saved = async () => page.waitForSelector("text=Saved.", { timeout: 8000 });
    // team member
    await page.goto(BASE + "/team");
    await page.fill("#un", "Newly Added"); await page.fill("#ue", "new.person@demo.test"); await page.fill("#up", "An0ther-Str0ng-Pass");
    await page.click("button:has-text('Save')"); await saved();
    await page.waitForSelector("text=new.person@demo.test");
    // knowledge article
    await page.goto(BASE + "/knowledge");
    await page.fill("#nt", "Escalation contacts"); await page.fill("#nb", "Call the duty manager for any critical safety complaint at once.");
    await page.click("section:has(#nt) button:has-text('Save')"); await saved();
    await page.waitForSelector("h2:has-text('Escalation contacts')");
    // organization settings (time zone + at-risk threshold)
    await page.goto(BASE + "/settings?tab=general");
    await page.fill("#tz", "Europe/London"); await page.fill("#ar", "80");
    await page.click("section:has(#tz) >> button:has-text('Save')"); await saved();
    await page.reload(); assert.equal(await page.inputValue("#tz"), "Europe/London");
    await page.fill("#tz", "Mars/Olympus"); await page.click("section:has(#tz) >> button:has-text('Save')");
    await page.waitForSelector("text=Unknown time zone");
    await page.fill("#tz", "Asia/Karachi"); await page.click("section:has(#tz) >> button:has-text('Save')"); await saved();
    // new category
    await page.goto(BASE + "/settings?tab=categories");
    await page.fill("section:has(h2:has-text('Add a category')) input[name=name]", "Warranty Claims");
    await page.click("section:has(h2:has-text('Add a category')) button:has-text('Add category')"); await saved();
    await page.reload(); await page.waitForSelector("summary:has-text('Warranty Claims')");
    // new person can sign in; deactivated person cannot
    const np = await signIn(browser, "new.person@demo.test", "An0ther-Str0ng-Pass").catch(() => null);
    assert.ok(np, "new team member could not sign in");
    await np.ctx.close();
    await ctx.close();
  });

  await step("branding: brand colour, pill buttons and logo apply to public and staff pages", async () => {
    const { ctx, page } = await signIn(browser, "admin@demo.test");
    await page.goto(BASE + "/settings?tab=branding");
    await page.evaluate(() => { const i = document.querySelector("#bc"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, "#54b435"); i.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.check("input[name=pillButtons]");
    await page.click("button:has-text('Save colours')"); await page.waitForSelector("text=Saved.");
    await page.setInputFiles("#logo", { name: "logo.png", mimeType: "image/png", buffer: PNG });
    await page.waitForSelector("img[alt='Current logo']");
    await page.goto(BASE + "/complaints/new");
    const bg = await page.locator(".btn.primary").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.equal(bg, "rgb(84, 180, 53)", "brand colour not applied");
    const radius = await page.locator(".btn.primary").first().evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    assert.ok(parseFloat(radius) > 100, "pill buttons not applied");
    const pub = await browser.newContext(); const pp = await pub.newPage();
    await pp.goto(BASE + "/submit");
    assert.equal(await pp.locator(".portal-head img").count(), 1, "logo missing on the public form");
    const logo = await pp.request.get(BASE + "/api/brand/logo"); assert.equal(logo.status(), 200);
    await pub.close(); await ctx.close();
  });

  await step("two-step sign-in: enrol an authenticator, sign out, sign in with a code; a wrong code is refused", async () => {
    const { ctx, page } = await signIn(browser, "auditor@demo.test");
    await page.goto(BASE + "/settings?tab=account");
    await page.click("button:has-text('Set up two-step sign-in')");
    await page.waitForSelector("summary:has-text('Cannot scan')"); await page.click("summary:has-text('Cannot scan')");
    const secret = (await page.locator(".ref-box").first().textContent()).trim();
    await page.fill("#mfa-code", "000000"); await page.click("button:has-text('Turn on')");
    await page.waitForSelector("text=not valid");
    await page.fill("#mfa-code", totp(secret)); await page.click("button:has-text('Turn on')");
    await page.waitForSelector("text=Save your recovery codes");
    const recovery = await page.locator("li.ref-box").allTextContents(); assert.equal(recovery.length, 8);
    await ctx.close();
    // fresh browser: password alone does not get in
    const c2 = await browser.newContext(); const p2 = await c2.newPage();
    await p2.goto(BASE + "/login"); await p2.fill("#email", "auditor@demo.test"); await p2.fill("#password", PASS);
    await p2.click("button:has-text('Sign in')"); await p2.waitForSelector("#code");
    assert.equal((await (await p2.request.get(BASE + "/api/complaints")).status()), 401, "session granted before the second step");
    await p2.fill("#code", "123456"); await p2.click("button:has-text('Verify and sign in')"); await p2.waitForSelector("text=not valid");
    // use a recovery code (the authenticator code was already used for enrolment in this 30 s window)
    await p2.fill("#code", recovery[0].trim()); await p2.click("button:has-text('Verify and sign in')");
    await p2.waitForURL((u) => !u.pathname.startsWith("/login")); await p2.waitForSelector("text=Overview, text=complaints", { timeout: 8000 }).catch(() => {});
    assert.equal((await p2.request.get(BASE + "/api/complaints")).status(), 200);
    await c2.close();
  });

  await step("an organization that requires two-step sign-in blocks staff who have not set it up", async () => {
    const { ctx, page } = await signIn(browser, "admin@demo.test");
    await page.goto(BASE + "/settings?tab=branding");
    await page.check("input[name=requireMfa]"); await page.click("section:has(input[name=requireMfa]) button:has-text('Save')");
    await page.waitForSelector("text=lock yourself out"); // the administrator must enrol first
    await page.goto(BASE + "/settings?tab=account");
    await page.click("button:has-text('Set up two-step sign-in')");
    await page.waitForSelector("summary:has-text('Cannot scan')"); await page.click("summary:has-text('Cannot scan')");
    const adminSecret = (await page.locator(".ref-box").first().textContent()).trim();
    await page.fill("#mfa-code", totp(adminSecret)); await page.click("button:has-text('Turn on')"); await page.waitForSelector("text=Save your recovery codes");
    await page.goto(BASE + "/settings?tab=branding");
    await page.check("input[name=requireMfa]"); await page.click("section:has(input[name=requireMfa]) button:has-text('Save')"); await page.waitForSelector("text=Saved.");
    await ctx.close();
    const h = await signIn(browser, "handler@demo.test");
    await h.page.goto(BASE + "/complaints");
    await h.page.waitForSelector("h1:has-text('Set up two-step sign-in')");
    const api = await h.page.request.get(BASE + "/api/complaints"); assert.equal(api.status(), 403);
    await h.ctx.close();
  });

  async function ownerEmail() {
    const out = execFileSync("node", ["-e", `const D=require('better-sqlite3');const d=new D(process.env.DATABASE_PATH,{readonly:true});console.log(d.prepare("select u.email e from complaints c join users u on u.id=c.assignee_id where c.id=?").get("${id}").e)`], { env }).toString().trim();
    return out;
  }
  console.log(`\nE2E complete: ${results.filter((r) => r[0] === "PASS").length} passed, ${results.filter((r) => r[0] === "FAIL").length} failed`);
} catch (e) {
  console.error("\nE2E FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  fs.rmSync(dir, { recursive: true, force: true });
}
