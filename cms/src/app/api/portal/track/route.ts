import { z } from "zod";
import { verifyAccess, publicView } from "@/server/portal";
import { signToken } from "@/server/tokens";
import { route, readJson } from "@/server/web";

export const POST = route({ auth: false }, async ({ db, req, ip }) => {
  const b = z.object({ ref: z.string().max(40), code: z.string().max(40) }).parse(await readJson(req));
  const c = verifyAccess(db, b.ref, b.code, ip);
  const view = publicView(db, c);
  return {
    ...view,
    // Download links expire after 10 minutes and are bound to this one complaint and file.
    attachments: view.attachments.map((a: any) => ({ ...a, url: `/api/portal/file?t=${signToken({ a: a.id, c: c.id }, 10 * 60_000)}` })),
  };
});
