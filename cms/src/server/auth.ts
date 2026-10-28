import crypto from "node:crypto";
import { type DB, newId, sha256 } from "./db";
import { audit } from "./audit";
import { allow } from "./ratelimit";
import type { Permission } from "@/lib/permissions";

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours absolute
const IDLE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours idle
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters.";
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/[0-9]/.test(pw)) return "Use upper case, lower case and a number.";
  return null;
}

export interface AuthContext {
  userId: string;
  name: string;
  email: string;
  roleKey: string;
  orgId: string; // active organization
  homeOrgId: string;
  perms: ReadonlySet<string>;
  departmentId: string | null;
  sessionId: string;
}

export type LoginResult = { ok: true; token: string; expiresAt: number } | { ok: false; error: string };

// Computed once so unknown emails cost the same time as wrong passwords.
const DUMMY_HASH = hashPassword("dummy-password-for-timing");

export function login(db: DB, email: string, password: string, meta: { ip?: string | null; userAgent?: string | null; now?: number } = {}): LoginResult {
  const now = meta.now ?? Date.now();
  const e = email.trim().toLowerCase();
  const generic = { ok: false as const, error: "Incorrect email or password." };
  if (!allow(db, `login:ip:${meta.ip ?? "?"}`, 30, 15 * 60_000, now) || !allow(db, `login:email:${e}`, 10, 15 * 60_000, now)) {
    return { ok: false, error: "Too many attempts. Try again in a few minutes." };
  }
  const u = db.prepare("SELECT * FROM users WHERE email = ?").get(e) as any;
  if (!u) {
    verifyPassword(password, DUMMY_HASH);
    audit(db, { orgId: null, action: "login.failed", actorLabel: e, ip: meta.ip, now, data: { reason: "unknown_user" } });
    return generic;
  }
  if (u.locked_until && u.locked_until > now) return { ok: false, error: "Account temporarily locked after repeated failures. Try again later." };
  if (!u.is_active) {
    audit(db, { orgId: u.org_id, actorId: u.id, action: "login.blocked", ip: meta.ip, now, data: { reason: "deactivated" } });
    return generic;
  }
  if (!verifyPassword(password, u.password_hash)) {
    const failed = u.failed_logins + 1;
    db.prepare("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?").run(failed, failed >= MAX_FAILED ? now + LOCK_MS : null, u.id);
    audit(db, { orgId: u.org_id, actorId: u.id, action: "login.failed", ip: meta.ip, now, data: { failed } });
    return generic;
  }
  db.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?").run(u.id);
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = now + SESSION_TTL_MS;
  db.prepare("INSERT INTO sessions (id, user_id, active_org_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?,?,?)").run(
    sha256(token), u.id, u.org_id, now, now, expiresAt, meta.ip ?? null, (meta.userAgent ?? "").slice(0, 200),
  );
  audit(db, { orgId: u.org_id, actorId: u.id, actorLabel: u.email, action: "login.success", ip: meta.ip, now });
  return { ok: true, token, expiresAt };
}

export function logout(db: DB, token: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sha256(token));
}

export function authenticate(db: DB, token: string | undefined | null, now = Date.now()): AuthContext | null {
  if (!token) return null;
  const s = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sha256(token)) as any;
  if (!s) return null;
  if (s.expires_at <= now || s.last_seen_at + IDLE_TTL_MS <= now) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(s.id);
    return null;
  }
  const u = db.prepare("SELECT u.*, r.key AS role_key FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?").get(s.user_id) as any;
  if (!u || !u.is_active) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(s.id);
    return null;
  }
  if (now - s.last_seen_at > 60_000) db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").run(now, s.id);
  const perms = new Set((db.prepare("SELECT permission FROM role_permissions WHERE role_id = ?").all(u.role_id) as any[]).map((r) => r.permission as string));
  // Only platform admins may act in an organization other than their own.
  const orgId = perms.has("platform.manage") ? s.active_org_id : u.org_id;
  return { userId: u.id, name: u.name, email: u.email, roleKey: u.role_key, orgId, homeOrgId: u.org_id, perms, departmentId: u.department_id, sessionId: s.id };
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export function requirePerm(ctx: AuthContext, ...any: Permission[]): void {
  if (!any.some((p) => ctx.perms.has(p))) throw new HttpError(403, "You do not have permission to do that.");
}

export function revokeUserSessions(db: DB, userId: string): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function switchOrg(db: DB, ctx: AuthContext, orgId: string): void {
  if (!ctx.perms.has("platform.manage")) throw new HttpError(403, "Only platform administrators can switch organizations.");
  if (!db.prepare("SELECT 1 FROM organizations WHERE id = ?").get(orgId)) throw new HttpError(404, "Organization not found.");
  db.prepare("UPDATE sessions SET active_org_id = ? WHERE id = ?").run(orgId, ctx.sessionId);
  audit(db, { orgId, actorId: ctx.userId, actorLabel: ctx.email, action: "org.switch" });
}

export { newId };
