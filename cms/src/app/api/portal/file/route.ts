import { NextResponse } from "next/server";
import { HttpError } from "@/server/auth";
import { getComplaintRow } from "@/server/complaints";
import { readAttachmentForComplainant } from "@/server/portal";
import { verifyToken } from "@/server/tokens";
import { route } from "@/server/web";
import type { NextRequest } from "next/server";

export const GET = route({ auth: false }, async ({ db, req }: { db: any; req: NextRequest }) => {
  const t = verifyToken<{ a: string; c: string }>(req.nextUrl.searchParams.get("t") ?? "");
  if (!t) throw new HttpError(403, "This download link has expired. Open the tracking page again.");
  const c = db.prepare("SELECT * FROM complaints WHERE id = ?").get(t.c);
  if (!c) throw new HttpError(404, "File not found.");
  void getComplaintRow;
  const f = readAttachmentForComplainant(db, c, t.a);
  return new NextResponse(new Uint8Array(f.data), { headers: { "Content-Type": f.mime, "Content-Disposition": `attachment; filename="${encodeURIComponent(f.filename)}"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
});
