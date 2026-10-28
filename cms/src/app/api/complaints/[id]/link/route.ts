import { z } from "zod";
import { route, readJson } from "@/server/web";
import { linkRelated } from "@/server/complaints";
export const POST = route<{ id: string }>({}, async ({ db, auth, req, params }) => {
  const b = z.object({ otherId: z.string() }).parse(await readJson(req));
  linkRelated(db, auth, params.id, b.otherId);
  return { ok: true };
});
