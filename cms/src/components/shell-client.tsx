"use client";
import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import { Suspense } from "react";
import { Icon } from "./ui";
import { api } from "./client";

type Item = { href: string; label: string; icon: string };

function Links({ items }: { items: Item[] }) {
  const path = usePathname();
  const sp = useSearchParams();
  const scope = sp.get("scope");
  const current = (href: string) => {
    const [p, q] = href.split("?");
    if (q) return path === p && scope === new URLSearchParams(q).get("scope");
    if (p === "/") return path === "/";
    return path.startsWith(p) && !(p === "/complaints" && scope);
  };
  return (
    <nav className="nav">
      {items.map((n) => (
        <Link key={n.href} href={n.href} aria-current={current(n.href) ? "page" : undefined} title={n.label}>
          <Icon name={n.icon} /><span>{n.label}</span>
        </Link>
      ))}
    </nav>
  );
}
export const NavLinks = (p: { items: Item[] }) => <Suspense fallback={null}><Links {...p} /></Suspense>;

export function SidebarToggle({ collapsed }: { collapsed: boolean }) {
  const router = useRouter();
  return (
    <button className="btn ghost sm" style={{ width: "100%", justifyContent: "flex-start" }} aria-pressed={collapsed} onClick={() => { document.cookie = `cms_nav=${collapsed ? "open" : "collapsed"}; path=/; max-age=31536000; samesite=lax`; router.refresh(); }}>
      <Icon name="panel" /><span className="label">{collapsed ? "Expand" : "Collapse"} sidebar</span>
    </button>
  );
}

export function SignOut() {
  return <button className="btn sm" onClick={async () => { await api("/api/auth/logout", "POST"); window.location.href = "/login"; }}>Sign out</button>;
}

export function OrgSwitcher({ orgs, current }: { orgs: { id: string; name: string }[]; current: string }) {
  const router = useRouter();
  return (
    <label className="row" style={{ gap: 6 }}>
      <span className="sr-only">Workspace</span>
      <select className="select" style={{ width: "auto" }} value={current} onChange={async (e) => { await api("/api/admin/switch-org", "POST", { orgId: e.target.value }); router.refresh(); }}>
        {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}
