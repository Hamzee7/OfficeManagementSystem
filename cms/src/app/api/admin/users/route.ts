import { z } from "zod";
import { route, readJson } from "@/server/web";
import { createUser } from "@/server/admin";

export const POST = route({}, async ({ db, auth, req }) => {
  const b = z.object({ email: z.string(), name: z.string(), password: z.string(), roleId: z.string(), departmentId: z.string().nullish(), location: z.string().nullish(), skills: z.array(z.string()).optional() }).parse(await readJson(req));
  return { id: createUser(db, auth, b) };
});
