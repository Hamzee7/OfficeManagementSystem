import crypto from "node:crypto";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s === "change-me") {
    if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be set to a long random value in production.");
    return "dev-only-insecure-secret";
  }
  return s;
}

/** Short-lived, tamper-proof token (HMAC). Used for attachment download links. */
export function signToken(payload: Record<string, string | number>, ttlMs: number, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: now + ttlMs })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken<T extends Record<string, any>>(token: string, now = Date.now()): T | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.exp > now ? (p as T) : null;
  } catch { return null; }
}
