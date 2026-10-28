import crypto from "node:crypto";
import type { DB } from "./db";

export interface AuditInput {
  orgId: string | null;
  actorId?: string | null;
  actorLabel?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
  ip?: string | null;
  now?: number;
}

const GENESIS = "0".repeat(64);

function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, val) => (val && typeof val === "object" && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val));
}

function hashOf(prev: string, row: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(prev + canonical(row)).digest("hex");
}

/**
 * Append to the tamper-evident audit log. Each record's hash covers the previous record's hash,
 * so editing or removing any earlier record breaks the chain (see verifyAuditChain).
 * Never pass passwords, tokens or complaint text in `data`.
 */
export function audit(db: DB, a: AuditInput): void {
  const run = db.transaction(() => {
    const last = db.prepare("SELECT hash FROM audit_events ORDER BY seq DESC LIMIT 1").get() as { hash: string } | undefined;
    const prev = last?.hash ?? GENESIS;
    const createdAt = a.now ?? Date.now();
    const row = { org_id: a.orgId, actor_id: a.actorId ?? null, actor_label: a.actorLabel ?? null, action: a.action, entity_type: a.entityType ?? null, entity_id: a.entityId ?? null, data: a.data ?? null, ip: a.ip ?? null, created_at: createdAt };
    const hash = hashOf(prev, row);
    db.prepare(
      "INSERT INTO audit_events (org_id, actor_id, actor_label, action, entity_type, entity_id, data, ip, created_at, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).run(row.org_id, row.actor_id, row.actor_label, row.action, row.entity_type, row.entity_id, a.data ? JSON.stringify(a.data) : null, row.ip, createdAt, prev, hash);
  });
  run.immediate();
}

export function verifyAuditChain(db: DB): { ok: boolean; checked: number; brokenAtSeq?: number } {
  const rows = db.prepare("SELECT * FROM audit_events ORDER BY seq").all() as any[];
  let prev = GENESIS;
  for (const r of rows) {
    const row = { org_id: r.org_id, actor_id: r.actor_id, actor_label: r.actor_label, action: r.action, entity_type: r.entity_type, entity_id: r.entity_id, data: r.data ? JSON.parse(r.data) : null, ip: r.ip, created_at: r.created_at };
    if (r.prev_hash !== prev || hashOf(prev, row) !== r.hash) return { ok: false, checked: rows.length, brokenAtSeq: r.seq };
    prev = r.hash;
  }
  return { ok: true, checked: rows.length };
}
