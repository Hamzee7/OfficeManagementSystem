import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { currentAuth } from "@/server/web";
import { loadOrg } from "@/server/org";
import { dashboard } from "@/server/reports";
import { Shell } from "@/components/Shell";
import { KpiGrid } from "@/components/Kpis";
import { VolumeChart } from "@/components/charts";
import { MiniList } from "@/components/Lists";
import { Empty } from "@/components/ui";
import { parseRange } from "@/server/dates";

export const dynamic = "force-dynamic";

export default async function Home() {
  const auth = await currentAuth();
  if (!auth) return <Landing />;
  if (!auth.perms.has("report.view")) {
    // People without reporting rights land on their own complaints.
    redirect(auth.perms.has("complaint.view.assigned") || auth.perms.has("complaint.view.all") ? "/complaints?scope=assigned" : "/complaints?scope=mine");
  }
  const db = getDb();
  const org = loadOrg(db, auth.orgId);
  const r = parseRange({}, org.timezone);
  const d = dashboard(db, auth, { from: r.from, to: r.to });
  const a = d.attention;
  const empty = d.kpis.created === 0 && d.kpis.openNow === 0;
  return (
    <Shell auth={auth}>
      <div className="page-head"><div><h1>Overview</h1><p className="sub">Last 30 days in {org.timezone}. <a href="/reports">Open full reports</a></p></div></div>
      {empty && <div className="card"><Empty title="No complaints yet" action={<a className="btn primary" href="/complaints/new">Log a complaint</a>}>Share your public form at <code>/submit</code>. Numbers and charts here are calculated from real records only.</Empty></div>}
      <KpiGrid k={d.kpis} />
      <div className="grid g2">
        <section className="card"><div className="card-head"><h2>Created vs resolved</h2></div><VolumeChart data={d.volume} /></section>
        <section className="card flush"><div className="card-head"><h2>Needs attention: critical</h2><a href="/complaints?priority=Critical">View</a></div><MiniList rows={a.critical} tz={org.timezone} /></section>
        <section className="card flush"><div className="card-head"><h2>Due within 24 hours</h2><a href="/complaints?sort=due_asc">View</a></div><MiniList rows={a.approachingSla} tz={org.timezone} /></section>
        <section className="card flush"><div className="card-head"><h2>Unassigned</h2><a href="/complaints?scope=unassigned">View</a></div><MiniList rows={a.unassigned} tz={org.timezone} /></section>
        <section className="card flush"><div className="card-head"><h2>Awaiting approval</h2><a href="/complaints?scope=awaiting_approval">View</a></div><MiniList rows={a.awaitingApproval} tz={org.timezone} /></section>
        <section className="card flush"><div className="card-head"><h2>Recently reopened</h2></div><MiniList rows={a.reopened} tz={org.timezone} /></section>
      </div>
    </Shell>
  );
}

function Landing() {
  const db = getDb();
  const org = db.prepare("SELECT name FROM organizations ORDER BY created_at LIMIT 1").get() as { name: string } | undefined;
  return (
    <div className="portal">
      <header className="portal-head"><div className="brand"><span className="brand-mark" aria-hidden="true">{(org?.name ?? "C").slice(0, 1)}</span><span>{org?.name ?? "Complaints"}</span></div><a href="/login" className="btn">Staff sign in</a></header>
      <main className="portal-main">
        <div className="hero"><h1>We want to hear when something goes wrong</h1><p>Every complaint gets a reference number, an owner and a deadline, and you can follow progress at any time.</p></div>
        <div className="grid g2">
          <a className="card stack" href="/submit" style={{ color: "inherit", textDecoration: "none" }}><h2>Submit a complaint</h2><p className="muted">No account needed. You can stay anonymous.</p><span className="btn primary" style={{ justifySelf: "start" }}>Start</span></a>
          <a className="card stack" href="/track" style={{ color: "inherit", textDecoration: "none" }}><h2>Track a complaint</h2><p className="muted">Use your reference and private access code.</p><span className="btn" style={{ justifySelf: "start" }}>Check status</span></a>
        </div>
      </main>
    </div>
  );
}
