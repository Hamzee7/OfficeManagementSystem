import { z } from "zod";
import { route, readJson } from "@/server/web";

export const GET = route({}, async ({ db, auth }) => ({
  items: db.prepare("SELECT id, type, title, body, link, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").all(auth.userId),
  unread: (db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL").get(auth.userId) as { n: number }).n,
}));

export const POST = route({}, async ({ db, auth, req }) => {
  const b = z.object({ ids: z.array(z.string()).optional() }).parse(await readJson(req));
  const now = Date.now();
  if (b.ids?.length) for (const id of b.ids) db.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL").run(now, id, auth.userId);
  else db.prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").run(now, auth.userId);
  return { ok: true };
});
