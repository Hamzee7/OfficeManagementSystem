import { z } from "zod";
import { route, readJson } from "@/server/web";
import { saveTemplate } from "@/server/admin";

export const POST = route({}, async ({ db, auth, req }) => {
  const b = z.object({ key: z.string(), subject: z.string(), body: z.string() }).parse(await readJson(req));
  saveTemplate(db, auth, b.key, b.subject, b.body);
  return { ok: true };
});
