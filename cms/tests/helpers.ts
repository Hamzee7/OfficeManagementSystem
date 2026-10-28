import { openDb, newId, type DB } from "@/server/db";
import { createOrganization } from "@/server/org";
import { hashPassword, authenticate, login, type AuthContext } from "@/server/auth";

export const PASSWORD = "Str0ngPassw0rd!";
const HASH = hashPassword(PASSWORD); // hashed once; scrypt is deliberately slow

export function freshDb(): DB {
  return openDb(":memory:");
}

export interface World {
  db: DB;
  orgId: string;
  roleIds: Record<string, string>;
  users: Record<string, string>;
}

export function addUser(db: DB, orgId: string, roleId: string, email: string, name: string, extra: Partial<{ departmentId: string; skills: string[]; location: string }> = {}): string {
  const id = newId();
  const now = Date.now();
  db.prepare("INSERT INTO users (id, org_id, email, name, password_hash, role_id, department_id, location, skills, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
    id, orgId, email, name, HASH, roleId, extra.departmentId ?? null, extra.location ?? null, JSON.stringify(extra.skills ?? []), now, now,
  );
  return id;
}

/** One organization with an admin, two managers, two handlers and an auditor. */
export function makeWorld(opts: { slug?: string; db?: DB; tz?: string } = {}): World {
  const db = opts.db ?? freshDb();
  const slug = opts.slug ?? "acme";
  const { orgId, roleIds } = createOrganization(db, { name: `Org ${slug}`, slug, timezone: opts.tz ?? "UTC" });
  const users: Record<string, string> = {
    admin: addUser(db, orgId, roleIds.org_admin, `admin@${slug}.test`, "Ada Admin"),
    manager: addUser(db, orgId, roleIds.manager, `manager@${slug}.test`, "Mo Manager"),
    manager2: addUser(db, orgId, roleIds.manager, `manager2@${slug}.test`, "Mia Manager"),
    handler: addUser(db, orgId, roleIds.handler, `handler@${slug}.test`, "Hal Handler"),
    handler2: addUser(db, orgId, roleIds.handler, `handler2@${slug}.test`, "Hana Handler"),
    auditor: addUser(db, orgId, roleIds.auditor, `auditor@${slug}.test`, "Audrey Auditor"),
    customer: addUser(db, orgId, roleIds.complainant, `customer@${slug}.test`, "Casey Customer"),
  };
  return { db, orgId, roleIds, users };
}

export function ctxFor(w: World, who: string, now = Date.now()): AuthContext {
  const row = w.db.prepare("SELECT email FROM users WHERE id = ?").get(w.users[who]) as { email: string };
  const r = login(w.db, row.email, PASSWORD, { ip: `10.0.0.${Math.floor(Math.random() * 250)}`, now });
  if (!r.ok) throw new Error("login failed in test: " + r.error);
  const ctx = authenticate(w.db, r.token, now);
  if (!ctx) throw new Error("authenticate failed in test");
  return ctx;
}

export const LONG = "The photocopier at our branch keeps jamming after the recent service visit and nobody has come back to fix it.";
