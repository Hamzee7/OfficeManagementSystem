import { z } from "zod";
import { route, readJson } from "@/server/web";
import { addHoliday, removeHoliday } from "@/server/admin";

export const POST = route({}, async ({ db, auth, req }) => {
  const b = z.object({ date: z.string(), name: z.string().default("Holiday"), remove: z.string().optional() }).parse(await readJson(req));
  if (b.remove) removeHoliday(db, auth, b.remove); else addHoliday(db, auth, b.date, b.name);
  return { ok: true };
});
