import { z } from "zod";
import { updateUser } from "@/server/admin";
import { route, readJson } from "@/server/web";

export const PATCH = route<{ id: string }>({}, async ({ db, auth, req, params }) => {
  const b = z.object({ roleId: z.string().optional(), departmentId: z.string().nullable().optional(), location: z.string().nullable().optional(), available: z.boolean().optional(), isActive: z.boolean().optional(), skills: z.array(z.string()).optional() }).parse(await readJson(req));
  updateUser(db, auth, params.id, b);
  return { ok: true };
});
