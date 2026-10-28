import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { currentAuth } from "@/server/web";
import { loadOrg, loadTransitions, DEFAULT_TEMPLATES } from "@/server/org";
import { PERMISSIONS, PERMISSION_LABELS } from "@/lib/permissions";
import { ApiForm, Field } from "@/components/client";
import { Empty } from "@/components/ui";

export const metadata = { title: "Settings" };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function Settings({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const auth = await currentAuth();
  if (!auth) redirect("/login");
  const can = (p: string) => auth.perms.has(p);
  const tabs = [
    ["general", "Organization", can("org.manage")], ["categories", "Categories & SLA", can("categories.manage")], ["workflow", "Workflow", can("workflow.manage")],
    ["roles", "Roles", can("roles.manage")], ["templates", "Message templates", can("org.manage")], ["integrations", "Integrations", can("org.manage")], ["account", "My account", true],
  ].filter((t) => t[2]) as [string, string, boolean][];
  const { tab: t } = await searchParams;
  const tab = tabs.find((x) => x[0] === t)?.[0] ?? tabs[0][0];
  const db = getDb();
  const org = loadOrg(db, auth.orgId);
  return (
    <>
      <div className="page-head"><div><h1>Settings</h1><p className="sub">{org.name}</p></div></div>
      <nav className="tabs" aria-label="Settings sections">{tabs.map(([k, l]) => <a key={k} href={`/settings?tab=${k}`} aria-current={tab === k ? "page" : undefined}>{l}</a>)}</nav>
      {tab === "general" && <General orgId={auth.orgId} />}
      {tab === "categories" && <Categories orgId={auth.orgId} />}
      {tab === "workflow" && <Workflow orgId={auth.orgId} />}
      {tab === "roles" && <Roles orgId={auth.orgId} canPlatform={can("platform.manage")} />}
      {tab === "templates" && <Templates orgId={auth.orgId} />}
      {tab === "integrations" && <Integrations />}
      {tab === "account" && <Account />}
      {can("platform.manage") && tab === "general" && <NewOrg />}
    </>
  );
}

function General({ orgId }: { orgId: string }) {
  const db = getDb();
  const o = db.prepare("SELECT * FROM organizations WHERE id = ?").get(orgId) as any;
  const days: number[] = JSON.parse(o.work_days);
  const holidays = db.prepare("SELECT id, date, name FROM holidays WHERE org_id = ? ORDER BY date").all(orgId) as any[];
  return (
    <div className="stack-lg">
      <section className="card stack"><h2>Organization and business calendar</h2>
        <p className="muted">SLA deadlines count only working time on this calendar. Deadlines are stored in UTC and shown in this time zone.</p>
        <ApiForm path="/api/admin/settings" resetOnSuccess={false} transform="settings">
          <div className="grid g2">
            <Field label="Organization name" htmlFor="on"><input id="on" name="name" className="input" defaultValue={o.name} required /></Field>
            <Field label="Time zone" hint="IANA name, e.g. Asia/Karachi, Europe/London, America/New_York" htmlFor="tz"><input id="tz" name="timezone" className="input" defaultValue={o.timezone} required /></Field>
            <Field label="Opens" htmlFor="ws"><input id="ws" name="workStart" type="time" className="input" defaultValue={o.work_start} required /></Field>
            <Field label="Closes" htmlFor="we"><input id="we" name="workEnd" type="time" className="input" defaultValue={o.work_end} required /></Field>
          </div>
          <fieldset className="row" style={{ border: 0, padding: 0 }}><legend className="label">Working days</legend>{DAYS.map((d, i) => <label key={d} className="check"><input type="checkbox" name="workDays" value={i} defaultChecked={days.includes(i)} />{d}</label>)}</fieldset>
          <div className="grid g2">
            <Field label="Assignment method" htmlFor="as"><select id="as" name="assignmentStrategy" className="select" defaultValue={o.assignment_strategy}><option value="workload">Workload-balanced</option><option value="round_robin">Round-robin</option><option value="rules">Rules-based (department, category, location)</option><option value="manual">Manual only</option></select></Field>
            <Field label="At-risk threshold (% of SLA used)" htmlFor="ar"><input id="ar" name="atRiskPct" type="number" min={10} max={99} className="input" defaultValue={o.at_risk_pct} /></Field>
            <Field label="Critical complaint may wait without an owner (business minutes)" htmlFor="cu"><input id="cu" name="criticalUnassignedMinutes" type="number" min={1} className="input" defaultValue={o.critical_unassigned_minutes} /></Field>
            <Field label="Escalate after this many reopenings" htmlFor="rt"><input id="rt" name="reopenThreshold" type="number" min={1} className="input" defaultValue={o.reopen_threshold} /></Field>
            <Field label="Remove complainant personal data this many days after closure" htmlFor="rd"><input id="rd" name="retentionDays" type="number" min={30} className="input" defaultValue={o.retention_days} /></Field>
          </div>
          <label className="check"><input type="checkbox" name="allowAnonymous" defaultChecked={!!o.allow_anonymous} />Allow anonymous complaints</label>
          <label className="check"><input type="checkbox" name="aiEnabled" defaultChecked={!!o.ai_enabled} />Enable assistance (suggested categories, summaries and draft replies). Suggestions only; staff decide.</label>
        </ApiForm>
      </section>
      <section className="card stack"><h2>Holidays</h2>
        {holidays.length ? <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>{holidays.map((h) => <li key={h.id} className="row-between"><span><strong>{h.date}</strong> {h.name}</span><ApiForm path="/api/admin/holidays" extra={{ date: h.date, remove: h.id }} submitLabel="Remove" className="row">{null}</ApiForm></li>)}</ul> : <p className="muted">No holidays. SLA clocks keep running on every working day.</p>}
        <ApiForm path="/api/admin/holidays" className="row" submitLabel="Add holiday"><input name="date" type="date" className="input" required aria-label="Holiday date" style={{ width: "auto" }} /><input name="name" className="input" placeholder="Name" aria-label="Holiday name" style={{ width: "auto" }} /></ApiForm>
      </section>
    </div>
  );
}

function Categories({ orgId }: { orgId: string }) {
  const db = getDb();
  const cats = db.prepare("SELECT * FROM categories WHERE org_id = ? ORDER BY name").all(orgId) as any[];
  const depts = db.prepare("SELECT id, name FROM departments WHERE org_id = ? ORDER BY name").all(orgId) as any[];
  const form = (c?: any) => (
    <ApiForm path="/api/admin/categories" resetOnSuccess={!c} extra={c ? { id: c.id } : {}} submitLabel={c ? "Save" : "Add category"}
      transform="category">
      <div className="grid g3">
        <Field label="Name" htmlFor={`cn${c?.id}`}><input id={`cn${c?.id}`} name="name" className="input" defaultValue={c?.name} required /></Field>
        <Field label="Department" htmlFor={`cd${c?.id}`}><select id={`cd${c?.id}`} name="departmentId" className="select" defaultValue={c?.department_id ?? ""}><option value="">None</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
        <Field label="Default priority" htmlFor={`cp${c?.id}`}><select id={`cp${c?.id}`} name="defaultPriority" className="select" defaultValue={c?.default_priority ?? "Medium"}><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select></Field>
        <Field label="Acknowledge within (business min)" htmlFor={`ca${c?.id}`}><input id={`ca${c?.id}`} name="ackMinutes" type="number" min={1} className="input" defaultValue={c?.ack_minutes ?? 240} required /></Field>
        <Field label="First response within" htmlFor={`cf${c?.id}`}><input id={`cf${c?.id}`} name="firstResponseMinutes" type="number" min={1} className="input" defaultValue={c?.first_response_minutes ?? 480} required /></Field>
        <Field label="Resolve within" htmlFor={`cr${c?.id}`}><input id={`cr${c?.id}`} name="resolutionMinutes" type="number" min={1} className="input" defaultValue={c?.resolution_minutes ?? 4800} required /></Field>
      </div>
      <Field label="Keywords used for suggested categorisation (comma separated)" htmlFor={`ck${c?.id}`}><input id={`ck${c?.id}`} name="keywords" className="input" defaultValue={c ? JSON.parse(c.keywords).join(", ") : ""} /></Field>
      <div className="row"><label className="check"><input type="checkbox" name="sensitive" defaultChecked={!!c?.sensitive} />Sensitive: never auto-assigned, a manager chooses the handler</label>{c && <label className="check"><input type="checkbox" name="active" defaultChecked={!!c.active} />Active</label>}</div>
    </ApiForm>
  );
  return (
    <div className="stack-lg">
      <p className="muted">Targets are in business minutes (480 = one 8-hour working day). Priority scales them: Critical 25%, High 50%, Medium 100%, Low 150%.</p>
      {cats.map((c) => <details key={c.id} className="card"><summary className="row-between" style={{ cursor: "pointer" }}><strong>{c.name}{c.sensitive ? " (sensitive)" : ""}{c.active ? "" : " (inactive)"}</strong><span className="muted small">ack {c.ack_minutes}m · response {c.first_response_minutes}m · resolve {c.resolution_minutes}m</span></summary><div style={{ marginTop: 12 }}>{form(c)}</div></details>)}
      <section className="card stack"><h2>Add a category</h2>{form()}</section>
    </div>
  );
}

function Workflow({ orgId }: { orgId: string }) {
  const rules = loadTransitions(getDb(), orgId);
  return (
    <section className="card flush">
      <div className="card-head"><div><h2>Status transitions</h2><p className="muted small">Control which moves are allowed and what they require. Some steps are locked on purpose: only approvers can close, and resolving always needs an approval decision.</p></div></div>
      {rules.length === 0 ? <Empty title="No transitions" /> : (
        <div className="table-wrap"><table><thead><tr><th>From</th><th>To</th><th>Needs permission</th><th>Comment required</th><th>Evidence required</th><th>Enabled</th><th /></tr></thead><tbody>
          {rules.map((r) => (
            <tr key={`${r.from}>${r.to}`}>
              <td>{r.from}</td><td>{r.to}</td><td className="muted small">{r.permission ?? "any staff or the complainant"}</td>
              <td colSpan={4}>
                <ApiForm path="/api/admin/workflow" resetOnSuccess={false} className="row" submitLabel="Save" extra={{ from: r.from, to: r.to }} transform="workflow">
                  <label className="check"><input type="checkbox" name="requiresComment" defaultChecked={r.requiresComment} /><span className="sr-only">Comment required</span>Comment</label>
                  <label className="check"><input type="checkbox" name="requiresEvidence" defaultChecked={r.requiresEvidence} />Evidence</label>
                  <label className="check"><input type="checkbox" name="enabled" defaultChecked={r.enabled} />Enabled</label>
                </ApiForm>
              </td>
            </tr>
          ))}
        </tbody></table></div>
      )}
    </section>
  );
}

function Roles({ orgId, canPlatform }: { orgId: string; canPlatform: boolean }) {
  const db = getDb();
  const roles = db.prepare("SELECT * FROM roles WHERE org_id = ? ORDER BY is_system DESC, name").all(orgId) as any[];
  const perms = (id: string) => new Set((db.prepare("SELECT permission FROM role_permissions WHERE role_id = ?").all(id) as any[]).map((r) => r.permission));
  const form = (r?: any) => {
    const have = r ? perms(r.id) : new Set<string>();
    return (
      <ApiForm path="/api/admin/roles" resetOnSuccess={!r} extra={r ? { id: r.id } : {}} submitLabel={r ? "Save role" : "Create role"} transform="roles">
        {!r || !r.is_system ? <div className="grid g2"><Field label="Role name" htmlFor={`rn${r?.id}`}><input id={`rn${r?.id}`} name="name" className="input" defaultValue={r?.name} required /></Field><Field label="Description" htmlFor={`rd${r?.id}`}><input id={`rd${r?.id}`} name="description" className="input" defaultValue={r?.description} /></Field></div> : null}
        <fieldset className="grid g2" style={{ border: 0, padding: 0 }}><legend className="label">Permissions</legend>
          {PERMISSIONS.filter((p) => canPlatform || p !== "platform.manage").map((p) => <label key={p} className="check"><input type="checkbox" name="permissions" value={p} defaultChecked={have.has(p)} disabled={!!r?.is_system} /><span>{PERMISSION_LABELS[p]}<br /><span className="mono muted small">{p}</span></span></label>)}
        </fieldset>
      </ApiForm>
    );
  };
  return (
    <div className="stack-lg">
      <p className="muted">Permissions are checked on the server for every request. Changes apply on each person&apos;s next click.</p>
      {roles.map((r) => (
        <details key={r.id} className="card"><summary style={{ cursor: "pointer" }} className="row-between"><strong>{r.name}</strong><span className="muted small">{r.is_system ? "Built in · read only" : "Custom"} · {perms(r.id).size} permissions</span></summary>
          <div style={{ marginTop: 12 }}><p className="muted">{r.description}</p>{r.is_system ? <ul className="chips" style={{ listStyle: "none", padding: 0 }}>{[...perms(r.id)].sort().map((p) => <li key={p} className="badge plain">{p}</li>)}</ul> : form(r)}</div></details>
      ))}
      <section className="card stack"><h2>Create a custom role</h2>{form()}</section>
    </div>
  );
}

function Templates({ orgId }: { orgId: string }) {
  const db = getDb();
  const over = new Map((db.prepare("SELECT key, subject, body FROM message_templates WHERE org_id = ?").all(orgId) as any[]).map((r) => [r.key, r]));
  return (
    <div className="stack-lg">
      <p className="muted">Use {"{{ref}}"}, {"{{name}}"}, {"{{org}}"}, {"{{message}}"}, {"{{trackUrl}}"}, {"{{code}}"}, {"{{due}}"}, {"{{title}}"}, {"{{link}}"}. Messages to complainants only ever receive the fields above, never internal notes.</p>
      {Object.entries(DEFAULT_TEMPLATES).map(([key, def]) => {
        const t = over.get(key) ?? def;
        return (
          <details key={key} className="card"><summary style={{ cursor: "pointer" }} className="row-between"><strong>{key.replace(/_/g, " ")}</strong><span className="muted small">{def.external ? "Sent to complainant" : "Sent to staff"}{over.has(key) ? " · customised" : ""}</span></summary>
            <div style={{ marginTop: 12 }}><ApiForm path="/api/admin/templates" resetOnSuccess={false} extra={{ key }}><Field label="Subject" htmlFor={`ts${key}`}><input id={`ts${key}`} name="subject" className="input" defaultValue={t.subject} required /></Field><Field label="Body" htmlFor={`tb${key}`}><textarea id={`tb${key}`} name="body" className="textarea" rows={7} defaultValue={t.body} required /></Field></ApiForm></div></details>
        );
      })}
    </div>
  );
}

function Integrations() {
  const rows = [
    ["Email (SMTP)", !!process.env.SMTP_HOST, "Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and MAIL_FROM. Until then messages are queued and logged by the worker only (development mode), not delivered."],
    ["SMS", false, "No SMS provider is implemented. The outbox already supports the channel; a provider adapter must be written and credentials added."],
    ["Single sign-on / identity provider", false, "Not implemented. Users sign in with email and password."],
    ["Webhooks, CRM, helpdesk, BI, document storage", false, "Not implemented. See docs/ARCHITECTURE.md for where adapters plug in."],
    ["AI provider", true, "Built-in rule-based assistant runs on this server. No data leaves your deployment. An external model is not connected."],
  ] as const;
  return (
    <section className="card flush"><div className="card-head"><h2>Integrations</h2></div>
      <div className="table-wrap"><table><thead><tr><th>Integration</th><th>Status</th><th>What is needed</th></tr></thead><tbody>
        {rows.map(([n, on, d]) => <tr key={n}><td><strong>{n}</strong></td><td>{on ? <span className="badge st-Resolved">Configured</span> : <span className="badge st-Closed">Not configured</span>}</td><td className="muted">{d}</td></tr>)}
      </tbody></table></div></section>
  );
}

function Account() {
  return (
    <section className="card stack" style={{ maxWidth: 480 }}><h2>Change password</h2>
      <ApiForm path="/api/auth/password" submitLabel="Change password">
        <Field label="Current password" htmlFor="cp"><input id="cp" name="current" type="password" className="input" autoComplete="current-password" required /></Field>
        <Field label="New password" hint="At least 10 characters with upper case, lower case and a number. Other devices are signed out." htmlFor="np"><input id="np" name="next" type="password" className="input" autoComplete="new-password" required minLength={10} /></Field>
      </ApiForm>
    </section>
  );
}

function NewOrg() {
  return (
    <section className="card stack"><h2>Create a new organization (platform administrators)</h2>
      <ApiForm path="/api/admin/organizations"><div className="grid g3"><Field label="Name" htmlFor="no"><input id="no" name="name" className="input" required /></Field><Field label="Short name (URL)" htmlFor="ns"><input id="ns" name="slug" className="input" required pattern="[a-z0-9\-]{2,40}" /></Field><Field label="Time zone" htmlFor="nz"><input id="nz" name="timezone" className="input" defaultValue="UTC" /></Field></div></ApiForm>
      <p className="hint">Use the workspace switcher in the top bar to enter it, then add its first administrator under Team.</p>
    </section>
  );
}
