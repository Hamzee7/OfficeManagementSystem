import { z } from "zod";
import { route, readJson } from "@/server/web";
import { saveLocation } from "@/server/admin";

export const POST = route({}, async ({ db, auth, req }) => {
  const b = z.object({ name: z.string() }).parse(await readJson(req));
  return { id: saveLocation(db, auth, b.name) };
});
