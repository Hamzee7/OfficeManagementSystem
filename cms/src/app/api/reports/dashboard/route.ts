import { dashboard } from "@/server/reports";
import { route } from "@/server/web";
import type { NextRequest } from "next/server";

export const GET = route({}, async ({ db, auth, req }: { db: any; auth: any; req: NextRequest }) => {
  const sp = req.nextUrl.searchParams;
  const to = sp.get("to") ? Number(sp.get("to")) : Date.now();
  const from = sp.get("from") ? Number(sp.get("from")) : to - 30 * 86_400_000;
  return dashboard(db, auth, { from, to, departmentId: sp.get("departmentId") ?? undefined, categoryId: sp.get("categoryId") ?? undefined, locationId: sp.get("locationId") ?? undefined });
});
