import { z } from "zod";
import { newId } from "@/server/db";
import { route, readJson } from "@/server/web";

export const GET = route({}, async ({ db, auth }) => ({ items: db.prepare("SELECT id, name, filters FROM saved_views WHERE user_id = ? AND org_id = ? ORDER BY name").all(auth.userId, auth.orgId) }));
export const POST = route({}, async ({ db, auth, req }) => {
  const b = z.object({ name: z.string().min(1).max(60), filters: z.record(z.string(), z.any()) }).parse(await readJson(req));
  const id = newId();
  db.prepare("INSERT INTO saved_views (id, org_id, user_id, name, filters, created_at) VALUES (?,?,?,?,?,?)").run(id, auth.orgId, auth.userId, b.name, JSON.stringify(b.filters), Date.now());
  return { id };
});
export const DELETE = route({}, async ({ db, auth, req }) => {
  const b = z.object({ id: z.string() }).parse(await readJson(req));
  db.prepare("DELETE FROM saved_views WHERE id = ? AND user_id = ?").run(b.id, auth.userId);
  return { ok: true };
});
