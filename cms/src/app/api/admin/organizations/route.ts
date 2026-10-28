import { z } from "zod";
import { route, readJson } from "@/server/web";
import { createOrganizationAsPlatformAdmin } from "@/server/admin";

export const POST = route({}, async ({ db, auth, req }) => {
  const b = z.object({ name: z.string(), slug: z.string(), timezone: z.string().optional() }).parse(await readJson(req));
  return createOrganizationAsPlatformAdmin(db, auth, b);
});
