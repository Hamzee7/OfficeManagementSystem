import { cookies, headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { getDb, type DB } from "./db";
import { authenticate, HttpError, type AuthContext } from "./auth";

export const SESSION_COOKIE = "cms_session";

export async function currentAuth(): Promise<AuthContext | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return authenticate(getDb(), token);
}

export function sessionCookieOptions(expiresAt: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: (process.env.APP_URL ?? "").startsWith("https"), path: "/", expires: new Date(expiresAt) };
}

export function clientIp(req: Request): string {
  // Behind a trusted reverse proxy the first hop is the client. Without one, spoofing only weakens rate limiting, not authorization.
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}

/** Reject cross-site state-changing requests (CSRF defence in addition to SameSite=Lax cookies). */
function checkOrigin(req: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (origin) {
    let o: string;
    try { o = new URL(origin).host; } catch { throw new HttpError(403, "Bad origin."); }
    if (o !== host) throw new HttpError(403, "Cross-site requests are not allowed.");
  } else if (req.headers.get("sec-fetch-site") === "cross-site") throw new HttpError(403, "Cross-site requests are not allowed.");
}

export interface Ctx<P> { db: DB; auth: AuthContext | null; ip: string; params: P; req: NextRequest }

/** Wrap a route: origin check, optional authentication, uniform JSON errors. Errors never leak internals. */
export function route<P = Record<string, string>>(opts: { auth: false }, fn: (c: Ctx<P>) => Promise<unknown | Response>): (req: NextRequest, extra: { params: Promise<P> }) => Promise<Response>;
export function route<P = Record<string, string>>(opts: { auth?: true }, fn: (c: Ctx<P> & { auth: AuthContext }) => Promise<unknown | Response>): (req: NextRequest, extra: { params: Promise<P> }) => Promise<Response>;
export function route<P>(opts: { auth?: boolean }, fn: (c: any) => Promise<unknown | Response>) {
  return async (req: NextRequest, extra: { params: Promise<P> }): Promise<Response> => {
    try {
      checkOrigin(req);
      const db = getDb();
      const auth = await currentAuth();
      if (opts.auth !== false && !auth) throw new HttpError(401, "Please sign in.");
      const out = await fn({ db, auth, ip: clientIp(req), params: await extra.params, req });
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
      if (e instanceof ZodError) return NextResponse.json({ error: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") }, { status: 422 });
      console.error("[api] unexpected error", e);
      return NextResponse.json({ error: "Something went wrong on our side. Please try again." }, { status: 500 });
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try { return await req.json(); } catch { throw new HttpError(400, "Send the request body as JSON."); }
}

/** Read one uploaded file from multipart form data. */
export async function readUpload(req: Request): Promise<{ filename: string; data: Buffer; fields: Record<string, string> }> {
  let form: FormData;
  try { form = await req.formData(); } catch { throw new HttpError(400, "Send the file as multipart form data."); }
  const f = form.get("file");
  if (!(f instanceof File)) throw new HttpError(422, "Choose a file to upload.");
  if (f.size > 10 * 1024 * 1024) throw new HttpError(413, "Files can be at most 10 MB.");
  const fields: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (typeof v === "string") fields[k] = v;
  return { filename: f.name, data: Buffer.from(await f.arrayBuffer()), fields };
}

export async function requestHost(): Promise<string> {
  return (await headers()).get("host") ?? "localhost";
}
