import { z } from "zod";
import { verifyAccess, complainantReopen } from "@/server/portal";
import { route, readJson } from "@/server/web";

export const POST = route({ auth: false }, async ({ db, req, ip }) => {
  const b = z.object({ ref: z.string(), code: z.string(), reason: z.string().min(3).max(3000) }).parse(await readJson(req));
  complainantReopen(db, verifyAccess(db, b.ref, b.code, ip), b.reason);
  return { ok: true };
});
