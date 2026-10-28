import { NextResponse } from "next/server";
import { z } from "zod";
import { login } from "@/server/auth";
import { route, readJson, SESSION_COOKIE, sessionCookieOptions } from "@/server/web";

export const POST = route({ auth: false }, async ({ db, req, ip }) => {
  const body = z.object({ email: z.string().max(200), password: z.string().max(200) }).parse(await readJson(req));
  const r = login(db, body.email, body.password, { ip, userAgent: req.headers.get("user-agent") });
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, r.token, sessionCookieOptions(r.expiresAt));
  return res;
});
