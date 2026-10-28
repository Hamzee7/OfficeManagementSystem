import { NextResponse } from "next/server";
import { exportComplaintsCsv } from "@/server/reports";
import { route } from "@/server/web";
import { filtersFromParams } from "@/server/filters";
import type { NextRequest } from "next/server";

export const GET = route({}, async ({ db, auth, req, ip }: { db: any; auth: any; req: NextRequest; ip: string }) => {
  const r = exportComplaintsCsv(db, auth, filtersFromParams(req.nextUrl.searchParams), ip);
  return new NextResponse(r.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="complaints-${new Date().toISOString().slice(0, 10)}.csv"`, "X-Export-Truncated": String(r.truncated), "Cache-Control": "no-store" } });
});
