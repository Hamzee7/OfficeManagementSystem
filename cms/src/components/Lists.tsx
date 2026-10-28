import { Empty, StatusBadge, PriorityBadge, SlaBadge, SlaMeter, fmtDate, ago } from "./ui";
import type { ListItem } from "@/server/complaints";

export function MiniList({ rows, tz }: { rows: any[]; tz: string }) {
  if (!rows.length) return <Empty title="Nothing here" />;
  return (
    <div className="table-wrap"><table className="mini"><tbody>
      {rows.map((c) => (
        <tr key={c.id}>
          <td className="title-cell"><a href={`/complaints/${c.id}`} className="mono">{c.ref}</a><div className="sub">{c.title}</div></td>
          <td><PriorityBadge priority={c.priority} /></td>
          <td className="muted small nowrap">{c.resolution_due_at ? fmtDate(c.resolution_due_at, tz) : ""}</td>
        </tr>
      ))}
    </tbody></table></div>
  );
}

export function ComplaintTable({ items, tz, showSla = true, select }: { items: ListItem[]; tz: string; showSla?: boolean; select?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="stack-table">
        <thead><tr>
          {select && <th><span className="sr-only">Select</span></th>}
          <th>Reference</th><th>Complaint</th><th>Status</th><th>Priority</th>{showSla && <th>SLA</th>}<th>Owner</th><th>Created</th>
        </tr></thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id}>
              {select && <td><input type="checkbox" name="ids" value={c.id} aria-label={`Select ${c.ref}`} form="bulk-form" /></td>}
              <td data-label="Reference" className="mono nowrap"><a href={`/complaints/${c.id}`}>{c.ref}</a></td>
              <td className="title-cell"><a href={`/complaints/${c.id}`}>{c.title}</a><div className="sub">{[c.category_name, c.department_name, c.location_name].filter(Boolean).join(" · ") || "Uncategorised"}{c.sensitive ? " · Sensitive" : ""}</div></td>
              <td data-label="Status"><StatusBadge status={c.status} /></td>
              <td data-label="Priority"><PriorityBadge priority={c.priority} /></td>
              {showSla && <td data-label="SLA" style={{ minWidth: 150 }}><SlaMeterLine c={c} tz={tz} /></td>}
              <td data-label="Owner" className="owner">{c.assignee_name ?? <span className="badge sla-At-Risk plain">Unassigned</span>}</td>
              <td data-label="Created" className="muted small nowrap" title={fmtDate(c.created_at, tz)}>{ago(c.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SlaMeterLine({ c, tz }: { c: ListItem; tz: string }) {
  if (c.sla.state === "Completed") return <span className="muted small">Completed</span>;
  return (
    <div style={{ display: "grid", gap: 3 }}>
      <SlaBadge sla={c.sla} />
      <SlaMeter sla={c.sla} />
      <span className="muted small">Due {fmtDate(c.sla.dueAt, tz)}</span>
    </div>
  );
}
