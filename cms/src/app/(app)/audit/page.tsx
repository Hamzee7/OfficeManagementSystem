import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { currentAuth } from "@/server/web";
import { verifyAuditChain } from "@/server/audit";
import { loadOrg } from "@/server/org";
import { Empty, fmtDateTime } from "@/components/ui";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const auth = await currentAuth();
  if (!auth) redirect("/login");
  if (!auth.perms.has("audit.view")) redirect("/");
  const { page: p } = await searchParams;
  const page = Math.max(1, Number(p ?? 1));
  const db = getDb();
  const tz = loadOrg(db, auth.orgId).timezone;
  const rows = db.prepare("SELECT seq, actor_label, action, entity_type, entity_id, data, ip, created_at FROM audit_events WHERE org_id = ? ORDER BY seq DESC LIMIT 50 OFFSET ?").all(auth.orgId, (page - 1) * 50) as any[];
  const chain = verifyAuditChain(db);
  return (
    <>
      <div className="page-head"><div><h1>Audit log</h1><p className="sub">Every important action, in order. Records cannot be edited or deleted.</p></div></div>
      <div className={`alert ${chain.ok ? "success" : "error"}`} role="status">{chain.ok ? `Integrity check passed: ${chain.checked.toLocaleString()} records are linked and unaltered.` : `Integrity check FAILED at record ${chain.brokenAtSeq}. The log may have been tampered with. Investigate immediately.`}</div>
      <section className="card flush">
        {rows.length === 0 ? <Empty title="Nothing recorded yet" /> : (
          <div className="table-wrap"><table><thead><tr><th>#</th><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>
            {rows.map((r) => (<tr key={r.seq}><td className="mono muted">{r.seq}</td><td className="nowrap small">{fmtDateTime(r.created_at, tz)}</td><td>{r.actor_label ?? "system"}</td><td><strong>{r.action}</strong></td><td className="muted small">{r.entity_type ? `${r.entity_type} ${String(r.entity_id ?? "").slice(0, 8)} ` : ""}{r.data ? r.data : ""}</td></tr>))}
          </tbody></table></div>
        )}
        <div className="pager"><span className="muted">Page {page}</span><div className="row">{page > 1 && <a className="btn sm" href={`/audit?page=${page - 1}`}>Newer</a>}{rows.length === 50 && <a className="btn sm" href={`/audit?page=${page + 1}`}>Older</a>}</div></div>
      </section>
    </>
  );
}
