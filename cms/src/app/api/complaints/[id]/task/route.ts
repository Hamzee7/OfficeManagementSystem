import { z } from "zod";
import { route, readJson } from "@/server/web";
import { addTask } from "@/server/complaints";
export const POST = route<{ id: string }>({}, async ({ db, auth, req, params }) => {
  const b = z.object({ title: z.string().max(200), ownerId: z.string().nullish(), dueAt: z.number().int().nullish() }).parse(await readJson(req));
  addTask(db, auth, params.id, b.title, b.ownerId ?? null, b.dueAt ?? null);
  return { ok: true };
});
