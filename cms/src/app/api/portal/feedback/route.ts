import { z } from "zod";
import { verifyAccess, complainantFeedback } from "@/server/portal";
import { route, readJson } from "@/server/web";

export const POST = route({ auth: false }, async ({ db, req, ip }) => {
  const b = z.object({ ref: z.string(), code: z.string(), rating: z.number().int(), comment: z.string().max(2000).default("") }).parse(await readJson(req));
  complainantFeedback(db, verifyAccess(db, b.ref, b.code, ip), b.rating, b.comment);
  return { ok: true };
});
