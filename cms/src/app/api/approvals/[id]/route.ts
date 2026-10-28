import { z } from "zod";
import { decideApproval } from "@/server/complaints";
import { route, readJson } from "@/server/web";

export const POST = route<{ id: string }>({}, async ({ db, auth, req, params }) => {
  const b = z.object({ approve: z.boolean(), comment: z.string().max(3000).default("") }).parse(await readJson(req));
  decideApproval(db, auth, params.id, b.approve, b.comment);
  return { ok: true };
});
