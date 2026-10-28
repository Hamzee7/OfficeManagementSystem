import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { currentAuth } from "@/server/web";
import { Empty, ago } from "@/components/ui";
import { ApiForm, Field } from "@/components/client";

export const metadata = { title: "Knowledge base" };

export default async function Knowledge({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const auth = await currentAuth();
  if (!auth) redirect("/login");
  if (!auth.perms.has("kb.view")) redirect("/");
  const { q } = await searchParams;
  const db = getDb();
  const like = `%${(q ?? "").replace(/[\\%_]/g, (m) => "\\" + m)}%`;
  const manage = auth.perms.has("kb.manage");
  const rows = db.prepare(`SELECT * FROM kb_articles WHERE org_id = ? ${manage ? "" : "AND published = 1"} AND (title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\') ORDER BY updated_at DESC LIMIT 100`).all(auth.orgId, like, like) as any[];
  return (
    <>
      <div className="page-head"><div><h1>Knowledge base</h1><p className="sub">Policies, FAQs and earlier resolutions. The assistant suggests these on a complaint, but they are reference material, not verified policy for that case.</p></div></div>
      <form className="row" role="search"><input className="input" name="q" defaultValue={q ?? ""} placeholder="Search articles" aria-label="Search articles" style={{ maxWidth: 360 }} /><button className="btn">Search</button></form>
      {rows.length === 0 ? <div className="card"><Empty title={q ? "No articles match" : "No articles yet"}>{manage ? "Write the first article below." : "Ask a manager to add policies and FAQs."}</Empty></div> : rows.map((a) => (
        <article key={a.id} className="card stack"><div className="row-between"><h2>{a.title}</h2><span className="muted small">{a.published ? "" : "Draft · "}updated {ago(a.updated_at)}</span></div><p style={{ whiteSpace: "pre-wrap" }}>{a.body}</p>
          {manage && <details><summary className="muted" style={{ cursor: "pointer" }}>Edit</summary><ApiForm path="/api/admin/kb" resetOnSuccess={false} extra={{ id: a.id }} transform="kb"><Field label="Title" htmlFor={`t${a.id}`}><input id={`t${a.id}`} name="title" className="input" defaultValue={a.title} required /></Field><Field label="Content" htmlFor={`b${a.id}`}><textarea id={`b${a.id}`} name="body" className="textarea" rows={5} defaultValue={a.body} required /></Field><label className="check"><input type="checkbox" name="published" defaultChecked={!!a.published} />Published</label></ApiForm></details>}
        </article>
      ))}
      {manage && <section className="card stack"><h2>New article</h2><ApiForm path="/api/admin/kb" transform="kb"><Field label="Title" htmlFor="nt"><input id="nt" name="title" className="input" required /></Field><Field label="Content" htmlFor="nb"><textarea id="nb" name="body" className="textarea" rows={5} required /></Field><label className="check"><input type="checkbox" name="published" defaultChecked />Publish now</label></ApiForm></section>}
    </>
  );
}
