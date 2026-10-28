import crypto from "node:crypto";
import { type DB, newId, sha256 } from "./db";
import { audit } from "./audit";
import { allow } from "./ratelimit";
import type { Permission } from "@/lib/permissions";
import { newSecret, otpauthUri, verifyTotp } from "@/lib/totp";
import { signToken, verifyToken } from "./tokens";

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
  mfaEnabled: boolean;
  /** The organization requires two-step sign-in and this person has not set it up yet: they can do nothing else until they do. */
  mfaSetupRequired: boolean;
}

export type LoginResult = { ok: true; token: string; expiresAt: number } | { ok: false; error: string; mfaRequired?: true; challenge?: string };

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
  if (u.mfa_enabled) {
    // Password was right; the second step is still required. Nothing is granted yet.
    return { ok: false, error: "Enter the 6-digit code from your authenticator app.", mfaRequired: true, challenge: signToken({ u: u.id, k: "mfa" }, MFA_CHALLENGE_MS, now) };
  }
  db.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?").run(u.id);
  return startSession(db, u, meta, now);
}

const MFA_CHALLENGE_MS = 5 * 60_000;

function startSession(db: DB, u: any, meta: { ip?: string | null; userAgent?: string | null }, now: number, how = "password"): LoginResult {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = now + SESSION_TTL_MS;
  db.prepare("INSERT INTO sessions (id, user_id, active_org_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?,?,?)").run(
    sha256(token), u.id, u.org_id, now, now, expiresAt, meta.ip ?? null, (meta.userAgent ?? "").slice(0, 200),
  );
  audit(db, { orgId: u.org_id, actorId: u.id, actorLabel: u.email, action: "login.success", ip: meta.ip, now, data: { how } });
  return { ok: true, token, expiresAt };
}

const recoveryHash = (code: string) => sha256("recovery:" + code.toUpperCase().replace(/[^A-Z0-9]/g, ""));

/** Second step of sign-in: an authenticator code, or a one-time recovery code. */
export function completeMfaLogin(db: DB, challenge: string, code: string, meta: { ip?: string | null; userAgent?: string | null; now?: number } = {}): LoginResult {
  const now = meta.now ?? Date.now();
  const bad = { ok: false as const, error: "That code is not valid. Check the time on your phone and try again." };
  const t = verifyToken<{ u: string; k: string }>(challenge, now);
  if (!t || t.k !== "mfa") return { ok: false, error: "Your sign-in timed out. Please start again." };
  if (!allow(db, `mfa:ip:${meta.ip ?? "?"}`, 30, 15 * 60_000, now) || !allow(db, `mfa:user:${t.u}`, 10, 15 * 60_000, now)) return { ok: false, error: "Too many attempts. Try again in a few minutes." };
  const u = db.prepare("SELECT * FROM users WHERE id = ?").get(t.u) as any;
  if (!u || !u.is_active || !u.mfa_enabled || !u.mfa_secret) return bad;
  if (u.locked_until && u.locked_until > now) return { ok: false, error: "Account temporarily locked after repeated failures. Try again later." };
  const step = verifyTotp(u.mfa_secret, code, now, u.mfa_last_step);
  let how = "totp";
  if (step != null) {
    // Remember the step so the same code can never be used twice (replay protection).
    const r = db.prepare("UPDATE users SET mfa_last_step = ? WHERE id = ? AND mfa_last_step < ?").run(step, u.id, step);
    if (r.changes === 0) return bad;
  } else {
    const rc = db.prepare("UPDATE mfa_recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL").run(now, u.id, recoveryHash(code));
    if (rc.changes === 0) {
      const failed = u.failed_logins + 1;
      db.prepare("UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?").run(failed, failed >= MAX_FAILED ? now + LOCK_MS : null, u.id);
      audit(db, { orgId: u.org_id, actorId: u.id, action: "login.mfa_failed", ip: meta.ip, now });
      return bad;
    }
    how = "recovery_code";
    audit(db, { orgId: u.org_id, actorId: u.id, action: "mfa.recovery_code_used", ip: meta.ip, now });
  }
  db.prepare("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?").run(u.id);
  return startSession(db, u, meta, now, how);
}

export function startMfaEnrollment(db: DB, ctx: AuthContext): { secret: string; uri: string } {
  if (ctx.mfaEnabled) throw new HttpError(409, "Two-step sign-in is already on. Turn it off first to set it up again.");
  const secret = newSecret();
  db.prepare("UPDATE users SET mfa_secret = ?, mfa_enabled = 0, mfa_last_step = 0 WHERE id = ?").run(secret, ctx.userId);
  const issuer = (db.prepare("SELECT name FROM organizations WHERE id = ?").get(ctx.homeOrgId) as { name: string }).name;
  return { secret, uri: otpauthUri(secret, ctx.email, issuer) };
}

function newRecoveryCodes(db: DB, userId: string): string[] {
  db.prepare("DELETE FROM mfa_recovery_codes WHERE user_id = ?").run(userId);
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const codes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const b = crypto.randomBytes(10);
    const c = Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
    codes.push(`${c.slice(0, 5)}-${c.slice(5)}`);
  }
  const ins = db.prepare("INSERT INTO mfa_recovery_codes (id, user_id, code_hash) VALUES (?,?,?)");
  for (const c of codes) ins.run(newId(), userId, recoveryHash(c));
  return codes;
}

/** Turns two-step sign-in on after the person proves their app works. Returns recovery codes, shown once. */
export function confirmMfaEnrollment(db: DB, ctx: AuthContext, code: string, now = Date.now()): string[] {
  const u = db.prepare("SELECT mfa_secret, mfa_enabled FROM users WHERE id = ?").get(ctx.userId) as any;
  if (u.mfa_enabled) throw new HttpError(409, "Two-step sign-in is already on.");
  if (!u.mfa_secret) throw new HttpError(409, "Start the setup first.");
  const step = verifyTotp(u.mfa_secret, code, now, 0);
  if (step == null) throw new HttpError(422, "That code is not valid. Check the time on your phone and try again.");
  return db.transaction(() => {
    db.prepare("UPDATE users SET mfa_enabled = 1, mfa_last_step = ? WHERE id = ?").run(step, ctx.userId);
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND id != ?").run(ctx.userId, ctx.sessionId);
    audit(db, { orgId: ctx.orgId, actorId: ctx.userId, actorLabel: ctx.email, action: "mfa.enabled", now });
    return newRecoveryCodes(db, ctx.userId);
  })();
}

export function disableMfa(db: DB, ctx: AuthContext, password: string, code: string, now = Date.now()): void {
  const u = db.prepare("SELECT password_hash, mfa_secret, mfa_enabled, mfa_last_step FROM users WHERE id = ?").get(ctx.userId) as any;
  if (!u.mfa_enabled) throw new HttpError(409, "Two-step sign-in is not on.");
  const org = db.prepare("SELECT require_mfa FROM organizations WHERE id = ?").get(ctx.homeOrgId) as { require_mfa: number };
  if (org.require_mfa) throw new HttpError(403, "Your organization requires two-step sign-in, so it cannot be turned off.");
  if (!verifyPassword(password, u.password_hash)) throw new HttpError(403, "Password is incorrect.");
  const step = verifyTotp(u.mfa_secret, code, now, u.mfa_last_step);
  if (step == null) throw new HttpError(422, "That code is not valid.");
  db.prepare("UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_last_step = 0 WHERE id = ?").run(ctx.userId);
  db.prepare("DELETE FROM mfa_recovery_codes WHERE user_id = ?").run(ctx.userId);
  audit(db, { orgId: ctx.orgId, actorId: ctx.userId, actorLabel: ctx.email, action: "mfa.disabled", now });
}

export function regenerateRecoveryCodes(db: DB, ctx: AuthContext, code: string, now = Date.now()): string[] {
  const u = db.prepare("SELECT mfa_secret, mfa_enabled, mfa_last_step FROM users WHERE id = ?").get(ctx.userId) as any;
  if (!u.mfa_enabled) throw new HttpError(409, "Two-step sign-in is not on.");
  const step = verifyTotp(u.mfa_secret, code, now, u.mfa_last_step);
  if (step == null) throw new HttpError(422, "That code is not valid.");
  db.prepare("UPDATE users SET mfa_last_step = ? WHERE id = ?").run(step, ctx.userId);
  audit(db, { orgId: ctx.orgId, actorId: ctx.userId, action: "mfa.recovery_codes_regenerated", now });
  return newRecoveryCodes(db, ctx.userId);
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
  const requireMfa = (db.prepare("SELECT require_mfa FROM organizations WHERE id = ?").get(u.org_id) as { require_mfa: number }).require_mfa === 1;
  return {
    userId: u.id, name: u.name, email: u.email, roleKey: u.role_key, orgId, homeOrgId: u.org_id, perms, departmentId: u.department_id, sessionId: s.id,
    mfaEnabled: !!u.mfa_enabled, mfaSetupRequired: requireMfa && !u.mfa_enabled && perms.size > 0,
  };
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
