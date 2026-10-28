import { z } from "zod";
import { verifyAccess, complainantMessage } from "@/server/portal";
import { route, readJson } from "@/server/web";

export const POST = route({ auth: false }, async ({ db, req, ip }) => {
  const b = z.object({ ref: z.string(), code: z.string(), body: z.string().max(6000) }).parse(await readJson(req));
  complainantMessage(db, verifyAccess(db, b.ref, b.code, ip), b.body);
  return { ok: true };
});
