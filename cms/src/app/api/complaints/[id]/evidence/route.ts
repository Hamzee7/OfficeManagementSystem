import { uploadAsStaff } from "@/server/storage";
import { route, readUpload } from "@/server/web";

export const POST = route<{ id: string }>({}, async ({ db, auth, req, params }) => {
  const u = await readUpload(req);
  return uploadAsStaff(db, auth, params.id, u.filename, u.data, u.fields.visibility === "public" ? "public" : "internal");
});
