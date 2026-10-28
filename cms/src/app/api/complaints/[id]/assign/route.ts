import { z } from "zod";
import { route, readJson } from "@/server/web";
import { assignComplaint } from "@/server/complaints";
export const POST = route<{ id: string }>({}, async ({ db, auth, req, params }) => {
  const b = z.object({ userId: z.string(), reason: z.string().max(1000).default("") }).parse(await readJson(req));
  assignComplaint(db, auth, params.id, b.userId, b.reason);
  return { ok: true };
});
