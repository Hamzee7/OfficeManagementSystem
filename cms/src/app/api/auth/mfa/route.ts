import { NextResponse } from "next/server";
import { z } from "zod";
import { completeMfaLogin } from "@/server/auth";
import { route, readJson, SESSION_COOKIE, sessionCookieOptions } from "@/server/web";

/** Second step of sign-in. */
export const POST = route({ auth: false }, async ({ db, req, ip }) => {
  const b = z.object({ challenge: z.string().max(600), code: z.string().max(40) }).parse(await readJson(req));
  const r = completeMfaLogin(db, b.challenge, b.code, { ip, userAgent: req.headers.get("user-agent") });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, r.token, sessionCookieOptions(r.expiresAt));
  return res;
});
