import { z } from "zod";
import { route, readJson } from "@/server/web";
import { saveRole } from "@/server/admin";

export const POST = route({}, async ({ db, auth, req }) => {
  const b = z.object({ id: z.string().optional(), name: z.string(), description: z.string().optional(), permissions: z.array(z.string()) }).parse(await readJson(req));
  return { id: saveRole(db, auth, b) };
});
