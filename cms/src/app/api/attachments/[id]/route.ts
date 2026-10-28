import { NextResponse } from "next/server";
import { readAttachmentForUser } from "@/server/storage";
import { route } from "@/server/web";

export const GET = route<{ id: string }>({}, async ({ db, auth, params }) => {
  const f = readAttachmentForUser(db, auth, params.id);
  const inline = f.mime.startsWith("image/") || f.mime === "application/pdf";
  return new NextResponse(new Uint8Array(f.data), { headers: { "Content-Type": f.mime, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(f.filename)}"`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox", "Cache-Control": "private, no-store" } });
});
