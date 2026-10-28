import { z } from "zod";
import { confirmMfaEnrollment } from "@/server/auth";
import { route, readJson } from "@/server/web";

export const POST = route({}, async ({ db, auth, req }) => {
  const b = z.object({ code: z.string().max(20) }).parse(await readJson(req));
  return { recoveryCodes: confirmMfaEnrollment(db, auth, b.code) };
});
