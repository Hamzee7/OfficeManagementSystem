import { z } from "zod";
import { verifyPassword } from "@/server/auth";
import { changeOwnPassword } from "@/server/admin";
import { route, readJson } from "@/server/web";

export const POST = route({}, async ({ db, auth, req }) => {
  const b = z.object({ current: z.string(), next: z.string() }).parse(await readJson(req));
  changeOwnPassword(db, auth, b.current, b.next, verifyPassword);
  return { ok: true };
});
