/** RFC 6238 time-based one-time passwords (the codes authenticator apps show). SHA-1, 6 digits, 30 seconds. */
import crypto from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of s.replace(/[\s=-]/g, "").toUpperCase()) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error("Invalid base32");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newSecret = () => base32Encode(crypto.randomBytes(20));

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", secret).update(buf).digest();
  const off = h[h.length - 1] & 15;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const STEP_SECONDS = 30;

/** Returns the matching time step (so it can be remembered and never accepted twice), or null. Allows one step of clock drift either way. */
export function verifyTotp(secretBase32: string, code: string, nowMs = Date.now(), lastUsedStep = 0, digits = 6): number | null {
  const clean = code.replace(/\s/g, "");
  if (!/^\d+$/.test(clean) || clean.length !== digits) return null;
  const secret = base32Decode(secretBase32);
  const step = Math.floor(nowMs / 1000 / STEP_SECONDS);
  for (const s of [step - 1, step, step + 1]) {
    if (s <= lastUsedStep) continue;
    const expected = Buffer.from(hotp(secret, s, digits));
    const given = Buffer.from(clean);
    if (expected.length === given.length && crypto.timingSafeEqual(expected, given)) return s;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
}
