import { redirect } from "next/navigation";
import { getDb } from "@/server/db";
import { currentAuth } from "@/server/web";
import { Empty } from "@/components/ui";
import { ApiForm, Field, ActionButton } from "@/components/client";

export const metadata = { title: "Team management" };

export default async function Team() {
  const auth = await currentAuth();
  if (!auth) redirect("/login");
  if (!auth.perms.has("users.manage")) redirect("/");
  const db = getDb();
  const users = db.prepare(`SELECT u.id, u.name, u.email, u.is_active, u.available, u.location, u.mfa_enabled, r.name AS role, d.name AS dept,
    (SELECT COUNT(*) FROM complaints c WHERE c.assignee_id = u.id AND c.status NOT IN ('Resolved','Closed','Rejected','Draft')) AS load
    FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN departments d ON d.id = u.department_id WHERE u.org_id = ? ORDER BY u.is_active DESC, u.name`).all(auth.orgId) as any[];
  const roles = db.prepare("SELECT id, name, key FROM roles WHERE org_id = ? ORDER BY is_system DESC, name").all(auth.orgId) as any[];
  const depts = db.prepare("SELECT id, name FROM departments WHERE org_id = ? AND active = 1 ORDER BY name").all(auth.orgId) as any[];
  const assignable = roles.filter((r) => r.key !== "super_admin" || auth.perms.has("platform.manage"));
  return (
    <>
      <div className="page-head"><div><h1>Team management</h1><p className="sub">Deactivating someone signs them out immediately and removes their access.</p></div></div>
      <section className="card flush">
        {users.length === 0 ? <Empty title="No users" /> : (
          <div className="table-wrap"><table className="stack-table"><thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Open cases</th><th>Availability</th><th>Two-step</th><th>Status</th><th /></tr></thead><tbody>
            {users.map((u) => (
              <tr key={u.id}><td><strong>{u.name}</strong><div className="muted small">{u.email}</div></td><td>{u.role}</td><td>{u.dept ?? "–"}</td><td>{u.load}</td>
                <td>{u.is_active ? <ActionButton path={`/api/admin/users/${u.id}`} method="PATCH" body={{ available: !u.available }} className="btn sm">{u.available ? "Available" : "Away"}</ActionButton> : "–"}</td>
                <td>{u.mfa_enabled ? <span className="badge st-Resolved">On</span> : <span className="badge st-Closed">Off</span>}{u.mfa_enabled && u.id !== auth.userId ? <ActionButton path={`/api/admin/users/${u.id}/mfa-reset`} className="btn sm ghost" confirm="Reset">Reset</ActionButton> : null}</td>
                <td>{u.is_active ? <span className="badge st-Resolved">Active</span> : <span className="badge st-Closed">Deactivated</span>}</td>
                <td>{u.id !== auth.userId && <ActionButton path={`/api/admin/users/${u.id}`} method="PATCH" body={{ isActive: !u.is_active }} className={`btn sm ${u.is_active ? "danger" : ""}`} confirm={u.is_active ? "Deactivate" : undefined}>{u.is_active ? "Deactivate" : "Reactivate"}</ActionButton>}</td></tr>
            ))}
          </tbody></table></div>
        )}
      </section>
      <section className="card stack"><h2>Add a team member</h2>
        <ApiForm path="/api/admin/users" transform="user">
          <div className="grid g2">
            <Field label="Full name" htmlFor="un"><input id="un" name="name" className="input" required /></Field>
            <Field label="Email" htmlFor="ue"><input id="ue" name="email" type="email" className="input" required autoComplete="off" /></Field>
            <Field label="Role" htmlFor="ur"><select id="ur" name="roleId" className="select" required>{assignable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
            <Field label="Department" htmlFor="ud"><select id="ud" name="departmentId" className="select"><option value="">None</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>
            <Field label="Temporary password" hint="At least 10 characters with upper case, lower case and a number. Ask them to change it after signing in." htmlFor="up"><input id="up" name="password" type="password" className="input" required autoComplete="new-password" minLength={10} /></Field>
          </div>
        </ApiForm>
      </section>
    </>
  );
}
