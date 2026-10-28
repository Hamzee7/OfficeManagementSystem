import { z } from "zod";
import { route, readJson } from "@/server/web";
import { transitionComplaint } from "@/server/complaints";
import type { Status } from "@/lib/workflow";
export const POST = route<{ id: string }>({}, async ({ db, auth, req, params }) => {
  const b = z.object({ to: z.string(), comment: z.string().max(5000).optional(), expectedVersion: z.number().int().optional() }).parse(await readJson(req));
  transitionComplaint(db, auth, params.id, b.to as Status, { comment: b.comment, expectedVersion: b.expectedVersion });
  return { ok: true };
});
