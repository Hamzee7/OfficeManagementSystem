import { z } from "zod";
import { route, readJson } from "@/server/web";
import { saveDepartment } from "@/server/admin";

export const POST = route({}, async ({ db, auth, req }) => {
  const b = z.object({ id: z.string().optional(), name: z.string(), managerId: z.string().nullish(), active: z.boolean().optional() }).parse(await readJson(req));
  return { id: saveDepartment(db, auth, b) };
});
