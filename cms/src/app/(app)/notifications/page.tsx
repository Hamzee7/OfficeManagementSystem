import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { currentAuth } from "@/server/web";
import { Empty, ago } from "@/components/ui";
import { ActionButton } from "@/components/client";

export const metadata = { title: "Notifications" };

export default async function Notifications() {
  const auth = await currentAuth();
  if (!auth) redirect("/login");
  const db = getDb();
  const items = db.prepare("SELECT id, type, title, body, link, read_at, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").all(auth.userId) as any[];
  const unread = items.filter((i) => !i.read_at).length;
  return (
    <>
      <div className="page-head"><div><h1>Notifications</h1><p className="sub">{unread ? `${unread} unread` : "You are all caught up."}</p></div>{unread > 0 && <ActionButton path="/api/notifications" body={{}} className="btn">Mark all as read</ActionButton>}</div>
      <section className="card flush">
        {items.length === 0 ? <Empty title="No notifications yet">You will be told here when a complaint is assigned to you, needs approval, or is escalated.</Empty> : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {items.map((n) => (
              <li key={n.id} className="row-between" style={{ padding: "12px 18px", borderBottom: "1px solid var(--line)", background: n.read_at ? "transparent" : "var(--brand-soft)" }}>
                <div><div className="strong">{n.link ? <a href={n.link}>{n.title}</a> : n.title}</div>{n.body && <div className="muted small">{n.body}</div>}<div className="muted small">{ago(n.created_at)} · {n.type.replace(/_/g, " ")}</div></div>
                {!n.read_at && <ActionButton path="/api/notifications" body={{ ids: [n.id] }} className="btn sm">Mark read</ActionButton>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
