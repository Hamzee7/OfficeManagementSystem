import Database from "better-sqlite3";
import type { DB } from "./db";
import { verifyAuditChain } from "./audit";

/** Copy the live database to `file` and prove the copy is sound before reporting success. */
export async function backupTo(db: DB, file: string): Promise<{ integrity: string; auditChainOk: boolean }> {
  await db.backup(file);
  return verifyBackup(file);
}

export function verifyBackup(file: string): { integrity: string; auditChainOk: boolean } {
  const copy = new Database(file, { readonly: true });
  try {
    const integrity = (copy.pragma("integrity_check", { simple: true }) as string) ?? "unknown";
    const auditChainOk = verifyAuditChain(copy as unknown as DB).ok;
    if (integrity !== "ok") throw new Error(`Backup failed integrity check: ${integrity}`);
    return { integrity, auditChainOk };
  } finally { copy.close(); }
}
