import { type DB, newId } from "./db";
import { renderTemplate } from "./org";

export interface InAppInput {
  orgId: string;
  userId: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  dedupeKey?: string;
  now?: number;
}

/** In-app notification. A repeated dedupeKey for the same user is ignored (no duplicates). */
export function notifyUser(db: DB, n: InAppInput): boolean {
  const r = db.prepare("INSERT INTO notifications (id, org_id, user_id, type, title, body, link, dedupe_key, created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING").run(
    newId(), n.orgId, n.userId, n.type, n.title, n.body ?? null, n.link ?? null, n.dedupeKey ?? null, n.now ?? Date.now(),
  );
  return r.changes > 0;
}

export function usersWithPermission(db: DB, orgId: string, permission: string): { id: string; email: string; name: string }[] {
  return db.prepare(
    `SELECT u.id, u.email, u.name FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id
     WHERE u.org_id = ? AND u.is_active = 1 AND rp.permission = ?`,
  ).all(orgId, permission) as any[];
}

export interface EmailInput {
  orgId: string;
  complaintId?: string | null;
  to: string | null | undefined;
  template: string;
  vars: Record<string, string | number | null | undefined>;
  /** Same key => same message is never queued twice. */
  key: string;
  now?: number;
}

/** Queue an email (or record it as skipped when there is no address). Delivery happens in the worker. */
export function queueEmail(db: DB, e: EmailInput): boolean {
  const now = e.now ?? Date.now();
  const idem = `${e.template}:${e.complaintId ?? "-"}:${e.to ?? "-"}:${e.key}`;
  const { subject, body } = renderTemplate(db, e.orgId, e.template, e.vars);
  const noAddress = !e.to;
  const r = db.prepare(
    `INSERT INTO outbox (id, org_id, complaint_id, channel, to_addr, template, subject, body, status, idempotency_key, next_attempt_at, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT (idempotency_key) DO NOTHING`,
  ).run(newId(), e.orgId, e.complaintId ?? null, "email", e.to ?? "", e.template, subject, body, noAddress ? "skipped" : "pending", idem, now, now);
  return r.changes > 0;
}

export interface MailTransport {
  name: string;
  send(msg: { to: string; subject: string; body: string }): Promise<void>;
}

/** Development transport: logs and succeeds. Clearly named so it is never mistaken for real delivery. */
export const consoleTransport: MailTransport = {
  name: "console-dev",
  async send(m) {
    console.log(`[mail:console-dev] to=${m.to} subject=${m.subject}`);
  },
};

export async function smtpTransportFromEnv(): Promise<MailTransport | null> {
  if (!process.env.SMTP_HOST) return null;
  const nodemailer = await import("nodemailer");
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return { name: "smtp", send: async (m) => void (await t.sendMail({ from: process.env.MAIL_FROM, to: m.to, subject: m.subject, text: m.body })) };
}

const MAX_ATTEMPTS = 5;

/** Deliver due messages. Failures retry with exponential back-off, then stay "failed" for review. */
export async function deliverOutbox(db: DB, transport: MailTransport, now = Date.now(), limit = 50): Promise<{ sent: number; failed: number }> {
  const due = db.prepare("SELECT * FROM outbox WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY created_at LIMIT ?").all(now, limit) as any[];
  let sent = 0, failed = 0;
  for (const m of due) {
    // Claim the row so two workers never send the same message.
    const claim = db.prepare("UPDATE outbox SET attempts = attempts + 1 WHERE id = ? AND status = 'pending' AND attempts = ?").run(m.id, m.attempts);
    if (claim.changes === 0) continue;
    try {
      await transport.send({ to: m.to_addr, subject: m.subject, body: m.body });
      db.prepare("UPDATE outbox SET status = 'sent', sent_at = ?, provider = ?, last_error = NULL WHERE id = ?").run(now, transport.name, m.id);
      sent++;
    } catch (err) {
      const attempts = m.attempts + 1;
      const final = attempts >= MAX_ATTEMPTS;
      db.prepare("UPDATE outbox SET status = ?, last_error = ?, next_attempt_at = ? WHERE id = ?").run(final ? "failed" : "pending", String((err as Error).message).slice(0, 300), now + 60_000 * 2 ** attempts, m.id);
      failed++;
    }
  }
  return { sent, failed };
}
