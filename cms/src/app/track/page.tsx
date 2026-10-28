import { TrackClient } from "@/components/PortalClient";
import { ThemeStyle, BrandMark } from "@/components/Theme";
import { getDb } from "@/server/db";
import { loadOrg } from "@/server/org";

export const dynamic = "force-dynamic";

export const metadata = { title: "Track a complaint" };

export default function Track() {
  const db = getDb();
  const first = db.prepare("SELECT id FROM organizations ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
  const org = first ? loadOrg(db, first.id) : null;
  return (
    <div className="portal">
      <ThemeStyle />
      <header className="portal-head"><a href="/" className="brand"><BrandMark name={org?.name ?? "Complaints"} hasLogo={!!org?.hasLogo} /><span>{org?.name ?? "Complaints"}</span></a><nav className="row"><a href="/submit">Submit a complaint</a><a href="/login">Staff sign in</a></nav></header>
      <main className="portal-main"><div className="hero"><h1>Track your complaint</h1><p>See the latest status, reply to questions, add files, or tell us how we did.</p></div><TrackClient /></main>
    </div>
  );
}
