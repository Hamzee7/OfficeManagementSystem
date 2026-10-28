import { z } from "zod";
import { proposeResolution } from "@/server/complaints";
import { route, readJson } from "@/server/web";

export const POST = route<{ id: string }>({}, async ({ db, auth, req, params }) => {
  const b = z.object({ text: z.string().max(6000) }).parse(await readJson(req));
  return { approvalId: proposeResolution(db, auth, params.id, b.text) };
});
