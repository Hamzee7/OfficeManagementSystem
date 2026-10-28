import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { getDb } from "@/server/db";
import { visibleNav } from "@/lib/permissions";
import { loadOrg } from "@/server/org";
import type { AuthContext } from "@/server/auth";
import { Icon } from "./ui";
import { ThemeStyle, BrandMark } from "./Theme";
import { NavLinks, SidebarToggle, SignOut, OrgSwitcher } from "./shell-client";

export async function Shell({ auth, children }: { auth: AuthContext; children: ReactNode }) {
  const db = getDb();
  const collapsed = (await cookies()).get("cms_nav")?.value === "collapsed";
  const org = loadOrg(db, auth.orgId);
  const unread = (db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL").get(auth.userId) as { n: number }).n;
  const isPlatform = auth.perms.has("platform.manage");
  const orgs = isPlatform ? (db.prepare("SELECT id, name FROM organizations ORDER BY name").all() as { id: string; name: string }[]) : [];
  const role = (db.prepare("SELECT r.name FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?").get(auth.userId) as { name: string }).name;
  const nav = visibleNav(auth.perms);
  // Everyone signed in can see their own complaints and notifications.
  const items = nav.some((n) => n.href === "/complaints?scope=mine") ? nav : [...nav.slice(0, 1), { href: "/complaints?scope=mine", label: "My Complaints", icon: "user" }, ...nav.slice(1)];
  const canCreate = auth.perms.has("complaint.create");

  return (
    <div className={`shell${collapsed ? " collapsed" : ""}`}>
      <ThemeStyle orgId={auth.orgId} />
      <a href="#main" className="skip">Skip to content</a>
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand"><BrandMark name={org.name} hasLogo={org.hasLogo} /><span className="name">{org.name}</span></div>
        <NavLinks items={items.filter((n, i, a) => a.findIndex((x) => x.href === n.href) === i)} />
        <div className="side-foot"><SidebarToggle collapsed={collapsed} /></div>
      </aside>
      <div className="main">
        <header className="topbar">
          <form className="search" action="/complaints" role="search">
            <Icon name="search" />
            <input className="input" type="search" name="q" placeholder="Search by reference, title or description" aria-label="Search complaints" />
          </form>
          <div className="spacer" />
          {isPlatform && <OrgSwitcher orgs={orgs} current={auth.orgId} />}
          {canCreate ? <a className="btn primary" href="/complaints/new"><Icon name="plus" /> New complaint</a> : <a className="btn primary" href="/submit"><Icon name="plus" /> New complaint</a>}
          <a className="btn icon-btn" href="/notifications" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}><Icon name="bell" />{unread > 0 && <span className="dot" aria-hidden="true">{unread > 99 ? "99+" : unread}</span>}</a>
          <a className="btn icon-btn" href="/help" aria-label="Help and support"><Icon name="help" /></a>
          <div style={{ textAlign: "right", lineHeight: 1.25 }}>
            <div className="strong" style={{ fontSize: 13.5 }}>{auth.name}</div>
            <div className="muted small">{role}</div>
          </div>
          <SignOut />
        </header>
        <main id="main" className="page fade-in" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
