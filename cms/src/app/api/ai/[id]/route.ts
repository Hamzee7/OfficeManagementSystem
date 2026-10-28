import { z } from "zod";
import { decideRecommendation } from "@/server/ai";
import { route, readJson } from "@/server/web";

export const POST = route<{ id: string }>({}, async ({ db, auth, req, params }) => {
  const b = z.object({ accept: z.boolean() }).parse(await readJson(req));
  decideRecommendation(db, auth, params.id, b.accept);
  return { ok: true };
});
