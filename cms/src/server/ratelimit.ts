import type { DB } from "./db";

/** Fixed-window limiter stored in the database so it works across processes. Returns false when over the limit. */
export function allow(db: DB, key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const win = Math.floor(now / windowMs) * windowMs;
  const tx = db.transaction(() => {
    db.prepare("INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1) ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1").run(key, win);
    const row = db.prepare("SELECT count FROM rate_limits WHERE key = ? AND window_start = ?").get(key, win) as { count: number };
    db.prepare("DELETE FROM rate_limits WHERE window_start < ?").run(win - windowMs * 4);
    return row.count <= limit;
  });
  return tx.immediate();
}
