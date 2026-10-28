import { z } from "zod";
import { route, readJson } from "@/server/web";
import { switchOrg } from "@/server/auth";

export const POST = route({}, async ({ db, auth, req }) => {
  const b = z.object({ orgId: z.string() }).parse(await readJson(req));
  switchOrg(db, auth, b.orgId);
  return { ok: true };
});
