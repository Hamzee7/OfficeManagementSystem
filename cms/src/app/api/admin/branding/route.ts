import { z } from "zod";
import { saveBranding } from "@/server/admin";
import { route, readJson } from "@/server/web";

export const POST = route({}, async ({ db, auth, req }) => {
  const b = z.object({ brandColor: z.string().optional(), pillButtons: z.boolean().optional(), requireMfa: z.boolean().optional() }).parse(await readJson(req));
  saveBranding(db, auth, b);
  return { ok: true };
});
