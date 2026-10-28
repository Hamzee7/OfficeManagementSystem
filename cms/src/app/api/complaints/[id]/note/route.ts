import { z } from "zod";
import { route, readJson } from "@/server/web";
import { addInternalNote } from "@/server/complaints";
export const POST = route<{ id: string }>({}, async ({ db, auth, req, params }) => {
  const b = z.object({ body: z.string().max(6000) }).parse(await readJson(req));
  addInternalNote(db, auth, params.id, b.body);
  return { ok: true };
});
