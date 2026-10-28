import { z } from "zod";
import { route, readJson } from "@/server/web";
import { sendMessage } from "@/server/complaints";
export const POST = route<{ id: string }>({}, async ({ db, auth, req, params }) => {
  const b = z.object({ body: z.string().max(6000), kind: z.enum(["update", "request_info"]).default("update") }).parse(await readJson(req));
  sendMessage(db, auth, params.id, b.body, b.kind);
  return { ok: true };
});
