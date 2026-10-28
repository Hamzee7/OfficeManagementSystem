import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { currentAuth } from "@/server/web";
import { dashboard } from "@/server/reports";
import { loadOrg } from "@/server/org";
import { parseRange } from "@/server/dates";
import { Empty } from "@/components/ui";
import { ApiForm, Field } from "@/components/client";
import { minutesLabel } from "@/components/ui";

export const metadata = { title: "Departments" };

export default async function Departments() {
  const auth = await currentAuth();
  if (!auth) redirect("/login");
  if (!auth.perms.has("departments.manage") && !auth.perms.has("complaint.view.all")) redirect("/");
  const db = getDb();
  const org = loadOrg(db, auth.orgId);
  const r = parseRange({}, org.timezone);
  const depts = db.prepare("SELECT d.*, m.name AS manager_name, (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id AND u.is_active = 1) AS people FROM departments d LEFT JOIN users m ON m.id = d.manager_id WHERE d.org_id = ? ORDER BY d.name").all(auth.orgId) as any[];
  const canReport = auth.perms.has("report.view");
  const perf = new Map<string, ReturnType<typeof dashboard>["kpis"]>();
  if (canReport) for (const d of depts) perf.set(d.id, dashboard(db, auth, { from: r.from, to: r.to, departmentId: d.id }).kpis);
  const people = db.prepare("SELECT id, name FROM users WHERE org_id = ? AND is_active = 1 ORDER BY name").all(auth.orgId) as any[];
  const locs = db.prepare("SELECT id, name FROM locations WHERE org_id = ? ORDER BY name").all(auth.orgId) as any[];
  const manage = auth.perms.has("departments.manage");
  return (
    <>
      <div className="page-head"><div><h1>Departments</h1><p className="sub">{canReport ? "Performance for the last 30 days." : "Who handles what."}</p></div></div>
      <section className="card flush">
        {depts.length === 0 ? <Empty title="No departments yet" /> : (
          <div className="table-wrap"><table className="stack-table"><thead><tr><th>Department</th><th>Manager</th><th>People</th>{canReport && <><th>Created</th><th>Open</th><th>Overdue</th><th>SLA met</th><th>Avg resolution</th></>}<th>Status</th></tr></thead><tbody>
            {depts.map((d) => { const k = perf.get(d.id); return (
              <tr key={d.id}><td><strong>{d.name}</strong></td><td>{d.manager_name ?? "–"}</td><td>{d.people}</td>
                {canReport && k && <><td>{k.created}</td><td>{k.openNow}</td><td className={k.overdueNow ? "strong" : ""} style={{ color: k.overdueNow ? "var(--bad)" : undefined }}>{k.overdueNow}</td><td>{k.slaCompliance == null ? "n/a" : `${k.slaCompliance}%`}</td><td>{minutesLabel(k.avgResolutionMinutes)}</td></>}
                <td>{d.active ? "Active" : "Inactive"}</td></tr>
            ); })}
          </tbody></table></div>
        )}
      </section>
      {manage && (
        <div className="grid g2">
          <section className="card stack"><h2>Add a department</h2><ApiForm path="/api/admin/departments"><Field label="Name" htmlFor="dn"><input id="dn" name="name" className="input" required minLength={2} /></Field><Field label="Manager" htmlFor="dm"><select id="dm" name="managerId" className="select"><option value="">None</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field></ApiForm></section>
          <section className="card stack"><h2>Locations and branches</h2>{locs.length ? <div className="chips">{locs.map((l) => <span key={l.id} className="badge plain">{l.name}</span>)}</div> : <p className="muted">None yet. If you add locations, the complaint form asks for one.</p>}<ApiForm path="/api/admin/locations"><Field label="New location" htmlFor="ln"><input id="ln" name="name" className="input" required minLength={2} /></Field></ApiForm></section>
        </div>
      )}
    </>
  );
}
