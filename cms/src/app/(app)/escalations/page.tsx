import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { currentAuth } from "@/server/web";
import { scopeSql } from "@/server/complaints";
import { loadOrg } from "@/server/org";
import { Empty, PriorityBadge, StatusBadge, fmtDateTime, ago } from "@/components/ui";
import { ActionButton } from "@/components/client";

export const metadata = { title: "Escalations" };
const RULES: Record<string, string> = { deadline_approaching: "Deadline approaching", sla_breached: "SLA breached", critical_unassigned: "Critical, no owner", no_first_response: "No first response", unresolved_too_long: "Unresolved too long", repeatedly_reopened: "Repeatedly reopened" };

export default async function Escalations() {
  const auth = await currentAuth();
  if (!auth) redirect("/login");
  if (!auth.perms.has("complaint.escalation.manage") && !auth.perms.has("complaint.view.all")) redirect("/");
  const db = getDb();
  const tz = loadOrg(db, auth.orgId).timezone;
  const sc = scopeSql(auth, "c");
  const rows = db.prepare(`SELECT e.*, c.ref, c.title, c.priority, c.status, c.id AS cid, u.name AS assignee FROM escalations e JOIN complaints c ON c.id = e.complaint_id LEFT JOIN users u ON u.id = c.assignee_id WHERE ${sc.sql} ORDER BY (e.acknowledged_at IS NOT NULL), e.created_at DESC LIMIT 200`).all(...sc.params) as any[];
  const open = rows.filter((r) => !r.acknowledged_at);
  const canAck = auth.perms.has("complaint.escalation.manage");
  return (
    <>
      <div className="page-head"><div><h1>Escalations</h1><p className="sub">{open.length} waiting for action. Raised automatically by the background worker, even when nobody is signed in.</p></div></div>
      <section className="card flush">
        {rows.length === 0 ? <Empty title="No escalations">Escalations appear when a deadline is near or missed, a critical complaint has no owner, or a case keeps being reopened.</Empty> : (
          <div className="table-wrap"><table className="stack-table"><thead><tr><th>Reason</th><th>Complaint</th><th>Priority</th><th>Status</th><th>Owner</th><th>Raised</th><th /></tr></thead><tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="Reason"><strong>{RULES[r.rule_key] ?? r.rule_key}</strong><div className="muted small">Level {r.level}. {r.message}</div></td>
                <td className="title-cell"><a href={`/complaints/${r.cid}`}>{r.ref}</a><div className="sub">{r.title}</div></td>
                <td><PriorityBadge priority={r.priority} /></td><td><StatusBadge status={r.status} /></td>
                <td>{r.assignee ?? <span className="badge sla-At-Risk plain">Unassigned</span>}</td>
                <td className="muted small" title={fmtDateTime(r.created_at, tz)}>{ago(r.created_at)}</td>
                <td>{r.acknowledged_at ? <span className="muted small">Acknowledged</span> : canAck ? <ActionButton path={`/api/escalations/${r.id}/ack`} className="btn sm">Acknowledge</ActionButton> : null}</td>
              </tr>
            ))}
          </tbody></table></div>
        )}
      </section>
    </>
  );
}
