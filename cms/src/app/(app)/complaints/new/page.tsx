import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { currentAuth } from "@/server/web";
import { NewComplaintForm } from "@/components/StaffForms";

export const metadata = { title: "Log a complaint" };

export default async function New() {
  const auth = await currentAuth();
  if (!auth) redirect("/login");
  if (!auth.perms.has("complaint.create")) redirect("/submit");
  const db = getDb();
  const q = (t: string) => db.prepare(`SELECT id, name FROM ${t} WHERE org_id = ? AND active = 1 ORDER BY name`).all(auth.orgId) as any[];
  return (
    <>
      <div className="page-head"><div><h1>Log a complaint</h1><p className="sub">For complaints received by phone, email or in person. The same routing, SLA and audit rules apply.</p></div></div>
      <NewComplaintForm categories={q("categories")} departments={q("departments")} locations={q("locations")} />
    </>
  );
}
