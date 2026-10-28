import { z } from "zod";
import { assist } from "@/server/ai";
import { route, readJson } from "@/server/web";

export const POST = route<{ id: string }>({}, async ({ db, auth, req, params }) => {
  const b = z.object({ kind: z.enum(["summary", "draft_update", "draft_resolution", "draft_request_info", "duplicates", "knowledge"]) }).parse(await readJson(req));
  return assist(db, auth, params.id, b.kind);
});
