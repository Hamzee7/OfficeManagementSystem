import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { currentAuth } from "@/server/web";
import { dashboard } from "@/server/reports";
import { loadOrg } from "@/server/org";
import { parseRange } from "@/server/dates";
import { KpiGrid, Definitions } from "@/components/Kpis";
import { VolumeChart, HBars, Donut, Columns } from "@/components/charts";
import { Empty, fmtDate } from "@/components/ui";
import { MiniList } from "@/components/Lists";
import { ApiForm, Field } from "@/components/client";

export const metadata = { title: "Reports & Analytics" };
type SP = Promise<Record<string, string | undefined>>;

export default async function Reports({ searchParams }: { searchParams: SP }) {
  const auth = await currentAuth();
  if (!auth) redirect("/login");
  if (!auth.perms.has("report.view")) redirect("/");
  const sp = await searchParams;
  const db = getDb();
  const org = loadOrg(db, auth.orgId);
  const r = parseRange(sp, org.timezone);
  const filters = { from: r.from, to: r.to, departmentId: sp.departmentId || undefined, categoryId: sp.categoryId || undefined, locationId: sp.locationId || undefined };
  const d = dashboard(db, auth, filters);
  const len = r.to - r.from;
  const prev = sp.compare ? dashboard(db, auth, { ...filters, from: r.from - len, to: r.from }).kpis : null;
  const depts = db.prepare("SELECT id, name FROM departments WHERE org_id = ? ORDER BY name").all(auth.orgId) as any[];
  const cats = db.prepare("SELECT id, name FROM categories WHERE org_id = ? ORDER BY name").all(auth.orgId) as any[];
  const locs = db.prepare("SELECT id, name FROM locations WHERE org_id = ? ORDER BY name").all(auth.orgId) as any[];
  const saved = db.prepare("SELECT id, name, filters FROM saved_views WHERE user_id = ? AND org_id = ? ORDER BY name").all(auth.userId, auth.orgId) as any[];
  const reports = saved.map((s) => ({ ...s, f: JSON.parse(s.filters) })).filter((s) => s.f.kind === "report");
  const qs = new URLSearchParams(Object.entries({ from: r.fromStr, to: r.toStr, departmentId: sp.departmentId, categoryId: sp.categoryId, locationId: sp.locationId }).filter(([, v]) => v) as [string, string][]);
  const exportQs = new URLSearchParams({ from: String(r.from), to: String(r.to), ...(sp.departmentId ? { departmentId: sp.departmentId } : {}), ...(sp.categoryId ? { categoryId: sp.categoryId } : {}), ...(sp.locationId ? { locationId: sp.locationId } : {}) });
  const att = d.attention;

  return (
    <>
      <div className="page-head">
        <div><h1>Reports &amp; analytics</h1><p className="sub">{fmtDate(r.from, org.timezone)} to {fmtDate(r.to - 1, org.timezone)} · time zone {org.timezone}. Only complaints you are allowed to see are counted.</p></div>
        {auth.perms.has("report.export") && <a className="btn" href={`/api/reports/export?${exportQs}`}>Export CSV</a>}
      </div>

      <form className="card row" method="get" style={{ alignItems: "flex-end" }}>
        <Field label="From" htmlFor="from"><input className="input" id="from" type="date" name="from" defaultValue={r.fromStr} /></Field>
        <Field label="To" htmlFor="to"><input className="input" id="to" type="date" name="to" defaultValue={r.toStr} /></Field>
        <Field label="Department" htmlFor="dep"><select className="select" id="dep" name="departmentId" defaultValue={sp.departmentId ?? ""}><option value="">All</option>{depts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Category" htmlFor="cat"><select className="select" id="cat" name="categoryId" defaultValue={sp.categoryId ?? ""}><option value="">All</option>{cats.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <Field label="Location" htmlFor="loc"><select className="select" id="loc" name="locationId" defaultValue={sp.locationId ?? ""}><option value="">All</option>{locs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
        <label className="check" style={{ paddingBottom: 8 }}><input type="checkbox" name="compare" value="1" defaultChecked={!!sp.compare} />Compare with previous period</label>
        <button className="btn primary">Apply</button>
      </form>

      {reports.length > 0 && <div className="chips">{reports.map((s) => <a key={s.id} className="btn sm" href={`/reports?${s.f.qs}`}>{s.name}</a>)}</div>}

      {d.kpis.created === 0 && d.kpis.resolved === 0 && d.kpis.openNow === 0 ? (
        <div className="card"><Empty title="No complaints in this period">Numbers appear here as complaints are submitted and resolved. Nothing on this page is sample data.</Empty></div>
      ) : (
        <>
          <KpiGrid k={d.kpis} prev={prev} />
          <div className="grid g2">
            <section className="card"><div className="card-head"><h2>Created vs resolved per day</h2></div><VolumeChart data={d.volume} /></section>
            <section className="card"><div className="card-head"><h2>SLA compliance by week</h2></div>
              {d.slaTrend.length ? <HBars rows={d.slaTrend.map((w) => ({ label: `Week of ${w.week.slice(5)}`, n: w.compliancePct }))} /> : <p className="muted">No complaints were resolved in this period.</p>}
              <p className="hint">Percent of complaints resolved that week which met their deadline.</p></section>
            <section className="card"><div className="card-head"><h2>By category</h2></div><HBars rows={d.byCategory} /></section>
            <section className="card"><div className="card-head"><h2>By department</h2></div><HBars rows={d.byDepartment} /></section>
            <section className="card"><div className="card-head"><h2>By location</h2></div><HBars rows={d.byLocation} /></section>
            <section className="card"><div className="card-head"><h2>By priority</h2></div><Donut rows={d.byPriority} /></section>
            <section className="card"><div className="card-head"><h2>By channel</h2></div><Donut rows={d.byChannel} /></section>
            <section className="card"><div className="card-head"><h2>Resolution time</h2></div><Columns rows={d.resolutionDistribution} /><p className="hint">Business time from creation to resolution, for complaints resolved in the period.</p></section>
            <section className="card"><div className="card-head"><h2>Handler workload</h2></div><HBars rows={d.workload} empty="No open assigned complaints." /></section>
            <section className="card"><div className="card-head"><h2>Recurring themes</h2></div>
              {d.themes.length ? <HBars rows={d.themes} /> : <p className="muted">No word appears in two or more complaint titles yet.</p>}
              <p className="hint">Words repeated across titles. A prompt to investigate, not a conclusion.</p></section>
          </div>
          <div className="grid g2">
            <section className="card flush"><div className="card-head"><h2>Critical, still open</h2></div><MiniList rows={att.critical} tz={org.timezone} /></section>
            <section className="card flush"><div className="card-head"><h2>Due within 24 hours</h2></div><MiniList rows={att.approachingSla} tz={org.timezone} /></section>
            <section className="card flush"><div className="card-head"><h2>Unassigned</h2></div><MiniList rows={att.unassigned} tz={org.timezone} /></section>
            <section className="card flush"><div className="card-head"><h2>Awaiting approval</h2></div><MiniList rows={att.awaitingApproval} tz={org.timezone} /></section>
          </div>
        </>
      )}

      <section className="card">
        <div className="card-head"><h2>Save this report</h2></div>
        <ApiForm path="/api/saved-views" submitLabel="Save report" extra={{ filters: { kind: "report", qs: qs.toString() } }} className="row">
          <input className="input" name="name" placeholder="Name, e.g. Monthly SLA review" aria-label="Report name" required style={{ maxWidth: 320 }} />
        </ApiForm>
        <p className="hint">Scheduled delivery by email is not available yet. See the known limitations in the documentation.</p>
      </section>
      <Definitions />
    </>
  );
}
