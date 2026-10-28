import { z } from "zod";
import { disableMfa } from "@/server/auth";
import { route, readJson } from "@/server/web";

export const POST = route({}, async ({ db, auth, req }) => {
  const b = z.object({ password: z.string(), code: z.string().max(20) }).parse(await readJson(req));
  disableMfa(db, auth, b.password, b.code);
  return { ok: true };
});
