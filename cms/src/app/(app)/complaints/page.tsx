import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { currentAuth } from "@/server/web";
import { listComplaints } from "@/server/complaints";
import { loadOrg } from "@/server/org";
import { STATUSES } from "@/lib/workflow";
import { PRIORITIES } from "@/lib/sla";
import { ComplaintTable } from "@/components/Lists";
import { Empty } from "@/components/ui";
import { BulkBar, SaveView } from "@/components/ListClient";
import { filtersFromParams } from "@/server/filters";

export const metadata = { title: "Complaints" };
type SP = Promise<Record<string, string | string[] | undefined>>;

const TITLES: Record<string, string> = { mine: "My complaints", assigned: "Assigned to me", unassigned: "Unassigned complaints", escalated: "Escalated complaints", awaiting_approval: "Awaiting approval" };

export default async function ComplaintsPage({ searchParams }: { searchParams: SP }) {
  const auth = await currentAuth();
  if (!auth) redirect("/login");
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) for (const x of Array.isArray(v) ? v : v ? [v] : []) sp.append(k, x);
  const db = getDb();
  const org = loadOrg(db, auth.orgId);
  const f = filtersFromParams(sp);
  const data = listComplaints(db, auth, f);
  const cats = db.prepare("SELECT id, name FROM categories WHERE org_id = ? ORDER BY name").all(auth.orgId) as any[];
  const depts = db.prepare("SELECT id, name FROM departments WHERE org_id = ? ORDER BY name").all(auth.orgId) as any[];
  const locs = db.prepare("SELECT id, name FROM locations WHERE org_id = ? ORDER BY name").all(auth.orgId) as any[];
  const staff = db.prepare("SELECT u.id, u.name FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id WHERE u.org_id = ? AND u.is_active = 1 AND rp.permission IN ('complaint.view.assigned','complaint.view.all') GROUP BY u.id ORDER BY u.name").all(auth.orgId) as any[];
  const views = (db.prepare("SELECT id, name, filters FROM saved_views WHERE user_id = ? AND org_id = ? ORDER BY name").all(auth.userId, auth.orgId) as any[]).map((v) => ({ ...v, f: JSON.parse(v.filters) })).filter((v) => v.f.kind !== "report");
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  const baseQs = new URLSearchParams(sp); baseQs.delete("page");
  const link = (p: number) => { const q = new URLSearchParams(baseQs); q.set("page", String(p)); return `/complaints?${q}`; };
  const canBulk = auth.perms.has("complaint.assign") || auth.perms.has("complaint.transition");
  const filterQs = baseQs.toString();
  const selected = (k: string) => sp.get(k) ?? "";

  return (
    <>
      <div className="page-head">
        <div><h1>{f.scope ? TITLES[f.scope] ?? "Complaints" : "All complaints"}</h1><p className="sub">{data.total.toLocaleString()} {data.total === 1 ? "complaint" : "complaints"}{f.q ? ` matching “${f.q}”` : ""}</p></div>
        <div className="row">{auth.perms.has("report.export") && <a className="btn" href={`/api/reports/export?${filterQs}`}>Export CSV</a>}</div>
      </div>

      {views.length > 0 && <div className="chips" aria-label="Saved views">{views.map((v) => <a key={v.id} className="btn sm" href={`/complaints?${v.f.qs}`}>{v.name}</a>)}</div>}

      <form className="card row" method="get" style={{ alignItems: "flex-end" }}>
        {f.scope && <input type="hidden" name="scope" value={f.scope} />}
        <div className="field" style={{ flex: "1 1 220px" }}><label htmlFor="q">Search</label><input className="input" id="q" name="q" type="search" defaultValue={f.q ?? ""} placeholder="Reference, title, description" /></div>
        <div className="field"><label htmlFor="status">Status</label><select className="select" id="status" name="status" defaultValue={selected("status")}><option value="">Any</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="field"><label htmlFor="priority">Priority</label><select className="select" id="priority" name="priority" defaultValue={selected("priority")}><option value="">Any</option>{PRIORITIES.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="field"><label htmlFor="categoryId">Category</label><select className="select" id="categoryId" name="categoryId" defaultValue={selected("categoryId")}><option value="">Any</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label htmlFor="departmentId">Department</label><select className="select" id="departmentId" name="departmentId" defaultValue={selected("departmentId")}><option value="">Any</option>{depts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        {locs.length > 0 && <div className="field"><label htmlFor="locationId">Location</label><select className="select" id="locationId" name="locationId" defaultValue={selected("locationId")}><option value="">Any</option>{locs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        {auth.perms.has("complaint.view.all") && <div className="field"><label htmlFor="assigneeId">Owner</label><select className="select" id="assigneeId" name="assigneeId" defaultValue={selected("assigneeId")}><option value="">Anyone</option>{staff.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        <div className="field"><label htmlFor="sort">Sort</label><select className="select" id="sort" name="sort" defaultValue={selected("sort")}><option value="created_desc">Newest first</option><option value="created_asc">Oldest first</option><option value="due_asc">Due soonest</option><option value="priority_desc">Highest priority</option><option value="updated_desc">Recently updated</option></select></div>
        <button className="btn primary">Apply</button>
        <a className="btn ghost" href={f.scope ? `/complaints?scope=${f.scope}` : "/complaints"}>Reset</a>
      </form>
      <SaveView qs={filterQs} />

      <section className="card flush">
        {data.items.length === 0 ? (
          <Empty title={sp.toString() ? "No complaints match these filters" : "No complaints yet"}>{sp.toString() ? "Try removing a filter." : "New complaints appear here as soon as they are submitted."}</Empty>
        ) : (
          <>
            <ComplaintTable items={data.items} tz={org.timezone} select={canBulk} />
            <div className="pager">
              <span className="muted">Page {data.page} of {pages}</span>
              <div className="row">
                {data.page > 1 && <a className="btn sm" href={link(data.page - 1)}>Previous</a>}
                {data.page < pages && <a className="btn sm" href={link(data.page + 1)}>Next</a>}
              </div>
            </div>
          </>
        )}
      </section>
      {canBulk && data.items.length > 0 && <BulkBar staff={staff} canAssign={auth.perms.has("complaint.assign")} />}
    </>
  );
}
