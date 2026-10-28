/**
 * Background worker. Run it next to the web server (`npm run worker`).
 * It does the work that must happen even when nobody has the site open:
 *   - SLA checks and escalations (every minute)
 *   - sending queued email, with retries (every minute)
 *   - removing expired sessions and old rate-limit rows
 *   - applying data-retention rules (hourly)
 */
import { getDb } from "@/server/db";
import { runSlaSweep, applyRetention } from "@/server/escalate";
import { deliverOutbox, consoleTransport, smtpTransportFromEnv, type MailTransport } from "@/server/notify";

const TICK_MS = Number(process.env.WORKER_TICK_MS ?? 60_000);
let stopping = false;
let lastRetention = 0;

async function tick(transport: MailTransport) {
  const db = getDb();
  const now = Date.now();
  const sweep = runSlaSweep(db, now);
  const mail = await deliverOutbox(db, transport, now);
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
  db.prepare("DELETE FROM rate_limits WHERE window_start < ?").run(now - 24 * 3600_000);
  let scrubbed = 0;
  if (now - lastRetention > 3600_000) {
    for (const o of db.prepare("SELECT id FROM organizations").all() as { id: string }[]) scrubbed += applyRetention(db, o.id, now);
    lastRetention = now;
  }
  console.log(`[worker] ${new Date(now).toISOString()} checked=${sweep.checked} escalations=${sweep.created} mail_sent=${mail.sent} mail_failed=${mail.failed} retention_scrubbed=${scrubbed}`);
}

async function main() {
  const smtp = await smtpTransportFromEnv();
  const transport = smtp ?? consoleTransport;
  if (!smtp) console.warn("[worker] SMTP_HOST is not set: emails are NOT delivered, only logged (development mode).");
  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });
  while (!stopping) {
    try { await tick(transport); } catch (e) { console.error("[worker] tick failed", e); }
    for (let waited = 0; waited < TICK_MS && !stopping; waited += 500) await new Promise((r) => setTimeout(r, 500));
  }
  console.log("[worker] stopped");
}

main();
