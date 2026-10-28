import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { storageDir } from "@/server/storage";

/** Public: an organization's logo is shown on its public pages, so it needs no sign-in. */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("org");
  const db = getDb();
  const o = (slug ? db.prepare("SELECT logo_key, logo_mime FROM organizations WHERE slug = ?").get(slug) : db.prepare("SELECT logo_key, logo_mime FROM organizations ORDER BY created_at LIMIT 1").get()) as { logo_key: string | null; logo_mime: string | null } | undefined;
  if (!o?.logo_key) return new NextResponse(null, { status: 404 });
  try {
    const data = fs.readFileSync(path.join(storageDir(), o.logo_key));
    return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": o.logo_mime ?? "image/png", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
  } catch { return new NextResponse(null, { status: 404 }); }
}
