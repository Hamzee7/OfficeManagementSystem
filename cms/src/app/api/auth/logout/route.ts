import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { logout } from "@/server/auth";
import { route, SESSION_COOKIE } from "@/server/web";

export const POST = route({ auth: false }, async ({ db }) => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) logout(db, token);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
});
