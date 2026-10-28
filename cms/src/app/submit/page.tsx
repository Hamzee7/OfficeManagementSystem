import { getDb } from "@/server/db";
import { loadOrg } from "@/server/org";
import { SubmitWizard } from "@/components/PortalClient";
import { ThemeStyle, BrandMark } from "@/components/Theme";

export const metadata = { title: "Submit a complaint" };
export const dynamic = "force-dynamic";

export default async function Submit({ searchParams }: { searchParams: Promise<{ org?: string }> }) {
  const db = getDb();
  const { org: slug } = await searchParams;
  const row = (slug ? db.prepare("SELECT id FROM organizations WHERE slug = ?").get(slug) : db.prepare("SELECT id FROM organizations ORDER BY created_at LIMIT 1").get()) as { id: string } | undefined;
  if (!row) return <PortalFrame><div className="card"><h1>Not available</h1><p>This complaints portal is not set up yet.</p></div></PortalFrame>;
  const org = loadOrg(db, row.id);
  const options = {
    org: { name: org.name, slug: org.slug, allowAnonymous: org.allowAnonymous },
    categories: db.prepare("SELECT id, name FROM categories WHERE org_id = ? AND active = 1 ORDER BY name").all(row.id) as any[],
    departments: db.prepare("SELECT id, name FROM departments WHERE org_id = ? AND active = 1 ORDER BY name").all(row.id) as any[],
    locations: db.prepare("SELECT id, name FROM locations WHERE org_id = ? AND active = 1 ORDER BY name").all(row.id) as any[],
  };
  return (
    <PortalFrame name={org.name} orgId={row.id} hasLogo={org.hasLogo} slug={org.slug}>
      <div className="hero"><h1>Tell us what went wrong</h1><p>It takes about three minutes. You will get a reference number and a private code to follow progress.</p></div>
      <SubmitWizard options={options} />
    </PortalFrame>
  );
}

function PortalFrame({ children, name = "Complaints", orgId, hasLogo = false, slug }: { children: React.ReactNode; name?: string; orgId?: string; hasLogo?: boolean; slug?: string }) {
  return (
    <div className="portal">
      {orgId && <ThemeStyle orgId={orgId} />}
      <header className="portal-head"><a href="/" className="brand"><BrandMark name={name} hasLogo={hasLogo} slug={slug} /><span>{name}</span></a><nav className="row"><a href="/track">Track a complaint</a><a href="/login">Staff sign in</a></nav></header>
      <main className="portal-main">{children}</main>
    </div>
  );
}
