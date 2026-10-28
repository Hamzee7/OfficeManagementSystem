import { z } from "zod";
import { route, readJson } from "@/server/web";
import { saveTransition } from "@/server/admin";

export const POST = route({}, async ({ db, auth, req }) => {
  const b = z.object({ from: z.string(), to: z.string(), requiresComment: z.boolean(), requiresEvidence: z.boolean(), enabled: z.boolean() }).parse(await readJson(req));
  saveTransition(db, auth, b);
  return { ok: true };
});
