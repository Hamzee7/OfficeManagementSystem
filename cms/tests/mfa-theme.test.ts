import { describe, it, expect } from "vitest";
import { hotp, verifyTotp, base32Encode, base32Decode, newSecret, otpauthUri } from "@/lib/totp";
import { themeCss, contrast, parseHex } from "@/lib/theme";
import { makeWorld, ctxFor, PASSWORD } from "./helpers";
import { login, completeMfaLogin, startMfaEnrollment, confirmMfaEnrollment, disableMfa, authenticate, regenerateRecoveryCodes } from "@/server/auth";
import { saveBranding, resetUserMfa } from "@/server/admin";
import { verifyAuditChain } from "@/server/audit";

const T = 1_700_000_000_000;
const codeAt = (secret: string, ms: number) => hotp(base32Decode(secret), Math.floor(ms / 30000));

describe("TOTP (RFC 6238)", () => {
  it("matches the official test vectors (SHA-1, secret '12345678901234567890')", () => {
    const secret = Buffer.from("12345678901234567890");
    // RFC 6238 appendix B, 8-digit codes; the 6-digit codes are the last six digits.
    expect(hotp(secret, Math.floor(59 / 30), 8)).toBe("94287082");
    expect(hotp(secret, Math.floor(1111111109 / 30), 8)).toBe("07081804");
    expect(hotp(secret, Math.floor(1234567890 / 30), 8)).toBe("89005924");
    expect(hotp(secret, Math.floor(59 / 30), 6)).toBe("287082");
  });
  it("round-trips base32 and generates usable secrets and URIs", () => {
    const b = Buffer.from("hello world!!");
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
    const s = newSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauthUri(s, "a@b.com", "Acme Ltd")).toMatch(/^otpauth:\/\/totp\/Acme%20Ltd%3Aa%40b\.com\?secret=/);
  });
  it("accepts one step of clock drift, rejects more, rejects reuse and junk", () => {
    const s = newSecret();
    const now = T;
    expect(verifyTotp(s, codeAt(s, now), now)).not.toBeNull();
    expect(verifyTotp(s, codeAt(s, now - 30000), now)).not.toBeNull();
    expect(verifyTotp(s, codeAt(s, now + 30000), now)).not.toBeNull();
    expect(verifyTotp(s, codeAt(s, now - 90000), now)).toBeNull();
    const step = verifyTotp(s, codeAt(s, now), now)!;
    expect(verifyTotp(s, codeAt(s, now), now, step)).toBeNull(); // replay
    expect(verifyTotp(s, "abcdef", now)).toBeNull();
    expect(verifyTotp(s, "12345", now)).toBeNull();
  });
});

describe("two-step sign-in", () => {
  function enroll(w: ReturnType<typeof makeWorld>, who = "manager", now = T) {
    const ctx = ctxFor(w, who, now);
    const { secret } = startMfaEnrollment(w.db, ctx);
    const recovery = confirmMfaEnrollment(w.db, ctx, codeAt(secret, now), now);
    return { secret, recovery, email: ctx.email };
  }
  it("requires the second step, then grants a session; the password alone is not enough", () => {
    const w = makeWorld();
    const { secret, email } = enroll(w);
    const t = T + 5 * 60_000; // a later sign-in, so the enrolment code cannot be reused
    const first = login(w.db, email, PASSWORD, { ip: "1.1.1.1", now: t });
    expect(first.ok).toBe(false);
    expect(first.ok === false && first.mfaRequired).toBe(true);
    const challenge = (first as any).challenge as string;
    expect(w.db.prepare("SELECT COUNT(*) n FROM sessions WHERE created_at = ?").get(t)).toEqual({ n: 0 });
    expect(completeMfaLogin(w.db, challenge, "000000", { ip: "1.1.1.1", now: t }).ok).toBe(false);
    const ok = completeMfaLogin(w.db, challenge, codeAt(secret, t), { ip: "1.1.1.1", now: t });
    expect(ok.ok).toBe(true);
    expect(authenticate(w.db, (ok as any).token, t)?.mfaEnabled).toBe(true);
    // the same code cannot be used for a second sign-in
    const again = login(w.db, email, PASSWORD, { ip: "1.1.1.2", now: t + 1000 }) as any;
    expect(completeMfaLogin(w.db, again.challenge, codeAt(secret, t), { ip: "1.1.1.2", now: t + 1000 }).ok).toBe(false);
  });
  it("recovery codes work exactly once", () => {
    const w = makeWorld();
    const { recovery, email } = enroll(w);
    expect(recovery).toHaveLength(8);
    const t = T + 10 * 60_000;
    const c1 = login(w.db, email, PASSWORD, { ip: "2.2.2.1", now: t }) as any;
    expect(completeMfaLogin(w.db, c1.challenge, recovery[0], { ip: "2.2.2.1", now: t }).ok).toBe(true);
    const c2 = login(w.db, email, PASSWORD, { ip: "2.2.2.2", now: t + 1 }) as any;
    expect(completeMfaLogin(w.db, c2.challenge, recovery[0], { ip: "2.2.2.2", now: t + 1 }).ok).toBe(false);
    expect((w.db.prepare("SELECT COUNT(*) n FROM audit_events WHERE action = 'mfa.recovery_code_used'").get() as any).n).toBe(1);
  });
  it("locks out repeated wrong codes, expires challenges, and never stores secrets in the audit log", () => {
    const w = makeWorld();
    const { secret, email } = enroll(w);
    const t = T + 20 * 60_000;
    const c = login(w.db, email, PASSWORD, { ip: "3.3.3.3", now: t }) as any;
    for (let i = 0; i < 5; i++) completeMfaLogin(w.db, c.challenge, "111111", { ip: "3.3.3.3", now: t + i });
    expect(completeMfaLogin(w.db, c.challenge, codeAt(secret, t), { ip: "3.3.3.3", now: t + 10 }).ok).toBe(false);
    const stale = login(w.db, "handler@acme.test", PASSWORD, { ip: "3.3.3.4", now: t });
    expect(stale.ok).toBe(true); // users without two-step sign in normally
    expect(completeMfaLogin(w.db, c.challenge, "000000", { ip: "3.3.3.5", now: t + 6 * 60_000 })).toMatchObject({ ok: false, error: expect.stringMatching(/timed out/) });
    expect(JSON.stringify(w.db.prepare("SELECT * FROM audit_events").all())).not.toContain(secret);
    expect(verifyAuditChain(w.db).ok).toBe(true);
  });
  it("turning it off needs password and a code; admin reset ends the user's sessions", () => {
    const w = makeWorld();
    const { secret } = enroll(w);
    const ctx = ctxFor(w, "manager", T + 30 * 60_000);
    expect(() => disableMfa(w.db, ctx, "wrong", codeAt(secret, T + 31 * 60_000), T + 31 * 60_000)).toThrow(/Password/);
    const admin = ctxFor(w, "admin", T);
    resetUserMfa(w.db, admin, w.users.manager);
    expect(w.db.prepare("SELECT mfa_enabled FROM users WHERE id = ?").get(w.users.manager)).toEqual({ mfa_enabled: 0 });
    expect(authenticate(w.db, "x")).toBeNull();
    expect(w.db.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id = ?").get(w.users.manager)).toEqual({ n: 0 });
    expect(() => resetUserMfa(w.db, ctxFor(w, "handler"), w.users.manager)).toThrow(/permission/);
  });
  it("recovery codes can be regenerated, invalidating the old ones", () => {
    const w = makeWorld();
    const { secret, recovery, email } = enroll(w);
    const ctx = ctxFor(w, "manager", T + 40 * 60_000);
    const fresh = regenerateRecoveryCodes(w.db, ctx, codeAt(secret, T + 41 * 60_000), T + 41 * 60_000);
    expect(fresh).not.toEqual(recovery);
    const c = login(w.db, email, PASSWORD, { ip: "4.4.4.4", now: T + 50 * 60_000 }) as any;
    expect(completeMfaLogin(w.db, c.challenge, recovery[0], { ip: "4.4.4.4", now: T + 50 * 60_000 }).ok).toBe(false);
    expect(completeMfaLogin(w.db, c.challenge, fresh[0], { ip: "4.4.4.4", now: T + 50 * 60_000 }).ok).toBe(true);
  });
  it("when the organization requires it, staff without it are blocked until they enrol; complainants are not", () => {
    const w = makeWorld();
    expect(() => saveBranding(w.db, ctxFor(w, "admin"), { requireMfa: true })).toThrow(/lock yourself out/);
    const adm = ctxFor(w, "admin");
    const { secret: adminSecret } = startMfaEnrollment(w.db, adm);
    confirmMfaEnrollment(w.db, adm, codeAt(adminSecret, Date.now()));
    saveBranding(w.db, ctxFor(w, "admin"), { requireMfa: true });
    expect(ctxFor(w, "handler").mfaSetupRequired).toBe(true);
    expect(ctxFor(w, "customer").mfaSetupRequired).toBe(false); // no staff permissions
    const ctx = ctxFor(w, "handler");
    const { secret } = startMfaEnrollment(w.db, ctx);
    confirmMfaEnrollment(w.db, ctx, codeAt(secret, Date.now()));
    expect(ctxFor(w, "handler").mfaSetupRequired).toBe(false);
    expect(() => disableMfa(w.db, ctxFor(w, "handler"), PASSWORD, "000000")).toThrow(/requires two-step/);
  });
});

describe("branding", () => {
  it("keeps text readable for any brand colour", () => {
    const white = parseHex("#ffffff")!;
    for (const hex of ["#54b435", "#ffd700", "#000000", "#ffffff", "#0274be", "#ff00ff", "#7a7a7a", "#00ff00"]) {
      const css = themeCss(hex, false);
      const pick = (name: string) => parseHex(new RegExp(`--${name}:(#[0-9a-f]{6})`).exec(css)![1])!;
      const brand = pick("brand"), ink = pick("brand-ink"), text = pick("brand-text");
      expect(contrast(brand, ink), `button text on ${hex}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(text, white), `link text for ${hex}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("validates colours and only allows org.manage", () => {
    const w = makeWorld();
    const admin = ctxFor(w, "admin");
    saveBranding(w.db, admin, { brandColor: "#54B435", pillButtons: true });
    expect(w.db.prepare("SELECT brand_color, pill_buttons FROM organizations WHERE id = ?").get(w.orgId)).toEqual({ brand_color: "#54b435", pill_buttons: 1 });
    expect(() => saveBranding(w.db, admin, { brandColor: "green" })).toThrow(/colour/);
    expect(() => saveBranding(w.db, ctxFor(w, "manager"), { brandColor: "#112233" })).toThrow(/permission/);
  });
});
