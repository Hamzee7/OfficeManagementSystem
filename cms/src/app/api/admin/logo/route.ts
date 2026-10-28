import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HttpError, requirePerm } from "@/server/auth";
import { audit } from "@/server/audit";
import { detectType, storageDir } from "@/server/storage";
import { route, readUpload } from "@/server/web";

const MAX_LOGO = 512 * 1024;

export const POST = route({}, async ({ db, auth, req }) => {
  requirePerm(auth, "org.manage");
  const u = await readUpload(req);
  if (u.data.length > MAX_LOGO) throw new HttpError(413, "Logos can be at most 512 KB.");
  const t = detectType(u.filename, u.data);
  if (!t || !["image/png", "image/jpeg", "image/webp"].includes(t.mime)) throw new HttpError(415, "Use a PNG, JPG or WebP image. (SVG is not accepted for safety.)");
  const key = "logo-" + crypto.randomBytes(16).toString("hex");
  fs.writeFileSync(path.join(storageDir(), key), u.data, { mode: 0o600 });
  const old = db.prepare("SELECT logo_key FROM organizations WHERE id = ?").get(auth.orgId) as { logo_key: string | null };
  db.prepare("UPDATE organizations SET logo_key = ?, logo_mime = ? WHERE id = ?").run(key, t.mime, auth.orgId);
  if (old.logo_key) fs.rmSync(path.join(storageDir(), old.logo_key), { force: true });
  audit(db, { orgId: auth.orgId, actorId: auth.userId, actorLabel: auth.email, action: "org.logo_changed" });
  return { ok: true };
});

export const DELETE = route({}, async ({ db, auth }) => {
  requirePerm(auth, "org.manage");
  const old = db.prepare("SELECT logo_key FROM organizations WHERE id = ?").get(auth.orgId) as { logo_key: string | null };
  if (old.logo_key) fs.rmSync(path.join(storageDir(), old.logo_key), { force: true });
  db.prepare("UPDATE organizations SET logo_key = NULL, logo_mime = NULL WHERE id = ?").run(auth.orgId);
  audit(db, { orgId: auth.orgId, actorId: auth.userId, actorLabel: auth.email, action: "org.logo_removed" });
  return { ok: true };
});
