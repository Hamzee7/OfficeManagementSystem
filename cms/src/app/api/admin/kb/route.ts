import { z } from "zod";
import { route, readJson } from "@/server/web";
import { saveArticle } from "@/server/admin";

export const POST = route({}, async ({ db, auth, req }) => {
  const b = z.object({ id: z.string().optional(), title: z.string(), body: z.string(), tags: z.array(z.string()).optional(), published: z.boolean().optional() }).parse(await readJson(req));
  return { id: saveArticle(db, auth, b) };
});
