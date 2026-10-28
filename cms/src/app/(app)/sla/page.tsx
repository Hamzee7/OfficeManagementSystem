import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { currentAuth } from "@/server/web";
import { listComplaints } from "@/server/complaints";
import { loadOrg } from "@/server/org";
import { OPEN_STATUSES } from "@/lib/workflow";
import { ComplaintTable } from "@/components/Lists";
import { Empty } from "@/components/ui";

export const metadata = { title: "SLA Monitoring" };

export default async function Sla({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const auth = await currentAuth();
  if (!auth) redirect("/login");
  const { state } = await searchParams;
  const db = getDb();
  const org = loadOrg(db, auth.orgId);
  const data = listComplaints(db, auth, { status: OPEN_STATUSES, sort: "due_asc", pageSize: 100 });
  const counts: Record<string, number> = { "On Track": 0, "At Risk": 0, Breached: 0, Paused: 0 };
  for (const i of data.items) counts[i.sla.state] = (counts[i.sla.state] ?? 0) + 1;
  const items = state ? data.items.filter((i) => i.sla.state === state) : data.items;
  const tabs = ["", "Breached", "At Risk", "On Track", "Paused"];
  return (
    <>
      <div className="page-head"><div><h1>SLA monitoring</h1><p className="sub">Open complaints, closest deadline first. Deadlines count business hours only, in {org.timezone}. {data.total > 100 ? `Showing the 100 most urgent of ${data.total}.` : ""}</p></div></div>
      <div className="grid g4">
        {Object.entries(counts).map(([k, n]) => <a key={k} href={`/sla?state=${encodeURIComponent(k)}`} className={`kpi ${k === "Breached" && n ? "bad" : ""}`} style={{ color: "inherit", textDecoration: "none" }}><span className="l">{k}</span><span className="v">{n}</span></a>)}
      </div>
      <nav className="tabs" aria-label="Filter by SLA state">{tabs.map((t) => <a key={t} href={t ? `/sla?state=${encodeURIComponent(t)}` : "/sla"} aria-current={(state ?? "") === t ? "page" : undefined}>{t || "All open"}</a>)}</nav>
      <section className="card flush">{items.length ? <ComplaintTable items={items} tz={org.timezone} /> : <Empty title="Nothing here">No open complaints in this state.</Empty>}</section>
    </>
  );
}
