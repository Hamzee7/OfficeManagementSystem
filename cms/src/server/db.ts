import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export type DB = Database.Database;

const MIGRATIONS_DIR = path.resolve(process.cwd(), "migrations");

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}

export function migrate(db: DB): string[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  const applied = new Set(db.prepare("SELECT name FROM schema_migrations").all().map((r: any) => r.name as string));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(f, Date.now());
    })();
    ran.push(f);
  }
  return ran;
}

const g = globalThis as unknown as { __cmsDb?: DB };

/** Process-wide connection (kept across Next.js hot reloads). */
export function getDb(): DB {
  if (!g.__cmsDb) g.__cmsDb = openDb(process.env.DATABASE_PATH ?? "./data/cms.db");
  return g.__cmsDb;
}

export const newId = () => crypto.randomUUID();
export const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");

export function nextCounter(db: DB, orgId: string, name: string): number {
  db.prepare("INSERT INTO counters (org_id, name, value) VALUES (?, ?, 0) ON CONFLICT (org_id, name) DO NOTHING").run(orgId, name);
  db.prepare("UPDATE counters SET value = value + 1 WHERE org_id = ? AND name = ?").run(orgId, name);
  return (db.prepare("SELECT value FROM counters WHERE org_id = ? AND name = ?").get(orgId, name) as { value: number }).value;
}
