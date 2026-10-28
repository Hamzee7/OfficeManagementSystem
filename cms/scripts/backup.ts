/**
 * Consistent online backup of the database (safe while the app is running).
 *   npm run backup -- ./backups
 * Also copy the STORAGE_DIR folder (attachments) with your normal file backup tool.
 */
import fs from "node:fs";
import path from "node:path";
import { getDb } from "../src/server/db";
import { backupTo } from "../src/server/backup";

const dir = path.resolve(process.argv[2] ?? "./backups");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `cms-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
backupTo(getDb(), file).then((r) => console.log(`Backup written to ${file} (integrity: ${r.integrity}, audit chain: ${r.auditChainOk ? "ok" : "BROKEN"})`)).catch((e) => { console.error("Backup failed:", e.message); process.exit(1); });
