import { z } from "zod";
import { route, readJson } from "@/server/web";
import { saveCategory } from "@/server/admin";

export const POST = route({}, async ({ db, auth, req }) => {
  const b = z.object({ id: z.string().optional(), name: z.string(), departmentId: z.string().nullish(), sensitive: z.boolean().optional(), defaultPriority: z.string().optional(), ackMinutes: z.number(), firstResponseMinutes: z.number(), resolutionMinutes: z.number(), keywords: z.array(z.string()).optional(), active: z.boolean().optional() }).parse(await readJson(req));
  return { id: saveCategory(db, auth, b) };
});
