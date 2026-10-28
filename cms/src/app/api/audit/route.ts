import { HttpError } from "@/server/auth";
import { verifyAuditChain } from "@/server/audit";
import { route } from "@/server/web";
import type { NextRequest } from "next/server";

export const GET = route({}, async ({ db, auth, req }: { db: any; auth: any; req: NextRequest }) => {
  if (!auth.perms.has("audit.view")) throw new HttpError(403, "You do not have permission to view the audit log.");
  const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") ?? 1));
  const items = db.prepare("SELECT seq, actor_label, action, entity_type, entity_id, data, created_at FROM audit_events WHERE org_id = ? ORDER BY seq DESC LIMIT 50 OFFSET ?").all(auth.orgId, (page - 1) * 50);
  return { items, chain: verifyAuditChain(db) };
});
