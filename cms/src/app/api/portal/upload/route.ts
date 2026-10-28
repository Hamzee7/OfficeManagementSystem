import { verifyAccess, complainantUpload } from "@/server/portal";
import { route, readUpload } from "@/server/web";

export const POST = route({ auth: false }, async ({ db, req, ip }) => {
  const u = await readUpload(req);
  const c = verifyAccess(db, u.fields.ref ?? "", u.fields.code ?? "", ip);
  return complainantUpload(db, c, u.filename, u.data);
});
