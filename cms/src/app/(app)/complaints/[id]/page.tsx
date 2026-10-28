import { redirect, notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { currentAuth } from "@/server/web";
import { getComplaintDetail } from "@/server/complaints";
import { HttpError } from "@/server/auth";
import { loadOrg } from "@/server/org";
import { StatusBadge, PriorityBadge, SlaBadge, SlaMeter, fmtDateTime, ago } from "@/components/ui";
import { TransitionForm, AssignForm, NoteForm, ProposeForm, ApprovalForm, TaskForm, UploadForm, AiPanel, DraftingMessage, CompleteTask } from "@/components/CaseClient";
import { ActionButton } from "@/components/client";
import { formatDuration } from "@/lib/sla";

export const metadata = { title: "Complaint" };

export default async function ComplaintPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await currentAuth();
  if (!auth) redirect("/login");
  const { id } = await params;
  const db = getDb();
  let d: any;
  try { d = getComplaintDetail(db, auth, id); } catch (e) { if (e instanceof HttpError && e.status === 404) notFound(); throw e; }
  const org = loadOrg(db, auth.orgId);
  const tz = org.timezone;
  const c = d.complaint;
  const staffView = !!d.tasks;
  const isAssignee = c.assignee_id === auth.userId;
  const manager = auth.perms.has("complaint.view.all");
  const staff = staffView ? (db.prepare("SELECT u.id, u.name FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id WHERE u.org_id = ? AND u.is_active = 1 AND rp.permission IN ('complaint.view.assigned','complaint.view.all') GROUP BY u.id ORDER BY u.name").all(auth.orgId) as { id: string; name: string }[]) : [];
  const pending = (d.approvals ?? []).find((a: any) => a.status === "pending");
  const canAct = staffView && (manager || isAssignee);
  const canPropose = canAct && auth.perms.has("complaint.transition") && ["Investigation in Progress", "Resolution Proposed"].includes(c.status);
  const canDecide = pending && auth.perms.has("complaint.approve") && pending.requested_by !== auth.userId;
  const pendingMine = pending && pending.requested_by === auth.userId && auth.perms.has("complaint.approve");
  const closed = ["Closed", "Rejected"].includes(c.status);
  const openEsc = (d.escalations ?? []).filter((e: any) => !e.acknowledged_at);

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 6 }}>
          <div className="row"><span className="mono muted">{c.ref}</span><StatusBadge status={c.status} /><PriorityBadge priority={c.priority} />{c.sensitive ? <span className="badge pr-High">Sensitive</span> : null}{c.is_anonymous ? <span className="badge plain">Anonymous</span> : null}</div>
          <h1>{c.title}</h1>
          <p className="sub muted">Opened {fmtDateTime(c.created_at, tz)} · updated {ago(c.updated_at)}</p>
        </div>
        <div style={{ minWidth: 260 }} className="card stack" aria-label="Service level">
          <div className="row-between"><strong>SLA</strong><SlaBadge sla={d.sla} /></div>
          <SlaMeter sla={d.sla} />
          <dl className="kv" style={{ gridTemplateColumns: "92px 1fr" }}>
            <dt>Due</dt><dd>{fmtDateTime(d.sla.dueAt, tz)}</dd>
            <dt>Used</dt><dd>{d.sla.consumedPct}% ({formatDuration(d.sla.elapsedMinutes)} of {formatDuration(d.sla.totalMinutes)})</dd>
            <dt>First response</dt><dd>{c.first_response_at ? fmtDateTime(c.first_response_at, tz) : `due ${fmtDateTime(c.first_response_due_at, tz)}`}</dd>
          </dl>
        </div>
      </div>

      {openEsc.length > 0 && staffView && (
        <div className="alert error" role="alert">
          <strong>Escalated.</strong> {openEsc.map((e: any) => e.message).join(" ")}
          {auth.perms.has("complaint.escalation.manage") && <span> {openEsc.map((e: any) => <ActionButton key={e.id} path={`/api/escalations/${e.id}/ack`} className="btn sm">Acknowledge</ActionButton>)}</span>}
        </div>
      )}

      <div className="split">
        <div className="stack-lg">
          <section className="card stack">
            <h2>What happened</h2>
            <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{c.description}</p>
            <dl className="kv">
              <dt>Category</dt><dd>{d.category?.name ?? "Not set"}</dd>
              <dt>Department</dt><dd>{d.department?.name ?? "Not set"}</dd>
              <dt>Location</dt><dd>{d.location?.name ?? "Not set"}</dd>
              <dt>Incident</dt><dd>{c.incident_at ? fmtDateTime(c.incident_at, tz) : "Not given"}</dd>
              <dt>Channel</dt><dd>{c.channel.replace("_", " ")}</dd>
              {c.related_ref && <><dt>Related ref</dt><dd>{c.related_ref}</dd></>}
              {staffView && <><dt>Complainant</dt><dd>{c.is_anonymous ? "Anonymous" : [c.complainant_name, c.complainant_email, c.complainant_phone].filter(Boolean).join(" · ") || "Details hidden or not provided"}</dd><dt>Contact by</dt><dd>{c.contact_method}</dd></>}
              <dt>Owner</dt><dd>{d.assignee?.name ?? "Unassigned"}</dd>
              {c.resolution_summary && <><dt>Resolution</dt><dd style={{ whiteSpace: "pre-wrap" }}>{c.resolution_summary}</dd></>}
              {d.survey && <><dt>Satisfaction</dt><dd>{d.survey.rating} / 5{d.survey.comment ? ` · ${d.survey.comment}` : ""}</dd></>}
            </dl>
          </section>

          {d.attachments.length > 0 && (
            <section className="card stack"><h2>Evidence</h2>
              <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {d.attachments.map((a: any) => (<li key={a.id} className="row-between"><a href={`/api/attachments/${a.id}`} target="_blank" rel="noreferrer">{a.filename}</a><span className="muted small">{(a.size / 1024).toFixed(0)} KB · {a.visibility === "internal" ? <span className="badge plain pill-internal">Staff only</span> : "Shared with complainant"} · {ago(a.created_at)}</span></li>))}
              </ul>
            </section>
          )}

          {staffView && d.related?.length > 0 && (
            <section className="card stack"><h2>Related complaints</h2><ul>{d.related.map((r: any) => <li key={r.id}><a href={`/complaints/${r.id}`}>{r.ref}</a> · {r.title} <StatusBadge status={r.status} /></li>)}</ul></section>
          )}

          <section className="card stack" aria-label="Activity timeline">
            <div className="row-between"><h2>Activity</h2><span className="muted small">{staffView ? "Yellow entries are staff-only." : "Updates from the team appear here."}</span></div>
            <ol className="timeline">
              {[...d.events].reverse().map((e: any) => (
                <li key={e.id} className={`tl-item ${e.visibility === "internal" ? "internal" : ""} ${e.actor_kind === "system" ? "system" : ""}`}>
                  <div className="tl-icon" aria-hidden="true">{(e.actor_name ?? (e.actor_kind === "system" ? "S" : "C")).slice(0, 1).toUpperCase()}</div>
                  <div className="tl-body">
                    <div className="tl-meta"><strong>{e.actor_kind === "system" ? "System" : e.actor_name ?? "Complainant"}</strong> · {e.type.replace(/_/g, " ")}{e.visibility === "internal" ? " · staff only" : ""} · <time title={fmtDateTime(e.created_at, tz)}>{ago(e.created_at)}</time></div>
                    {e.body && <div className="tl-text">{e.body}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {staffView && d.assignments.length > 0 && (
            <section className="card stack"><h2>Assignment history</h2>
              <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>{d.assignments.map((a: any) => <li key={a.id}>{fmtDateTime(a.created_at, tz)}: {a.from_name ? `${a.from_name} → ` : ""}<strong>{a.to_name}</strong> by {a.by_name ?? "the system"} ({a.strategy}){a.reason ? ` · ${a.reason}` : ""}</li>)}</ul></section>
          )}
        </div>

        <aside className="stack-lg sticky-actions" aria-label="Case actions">
          {canDecide && <section className="card stack"><h2>Approval needed</h2><ApprovalForm approvalId={pending.id} proposed={pending.proposed_resolution} /></section>}
          {pendingMine && <div className="alert info">You proposed this resolution, so another manager must approve it.</div>}
          {canAct && !closed && <section className="card stack"><h2>Change status</h2><TransitionForm id={c.id} version={c.version} options={d.allowedTransitions} /></section>}
          {!canAct && !staffView && c.status === "Resolved" && <div className="alert info">This complaint is resolved. Use the tracking page with your access code to reopen it or leave feedback.</div>}
          {auth.perms.has("complaint.assign") && !closed && <section className="card stack"><h2>Owner</h2><AssignForm id={c.id} staff={staff} currentId={c.assignee_id} /></section>}
          {canPropose && !pending && <section className="card stack"><h2>Propose resolution</h2><ProposeForm id={c.id} /></section>}
          {canAct && auth.perms.has("complaint.message.external") && !closed && <section className="card stack"><h2>Assistant and messages</h2><DraftingMessage id={c.id} /></section>}
          {canAct && auth.perms.has("complaint.note.internal") && <section className="card stack"><h2>Internal note</h2><NoteForm id={c.id} /></section>}
          {staffView && (
            <section className="card stack"><h2>Tasks</h2>
              {d.tasks.length === 0 ? <p className="muted">No tasks yet.</p> : <ul className="stack" style={{ margin: 0, padding: 0, listStyle: "none" }}>{d.tasks.map((t: any) => <li key={t.id} className="row-between"><span style={{ textDecoration: t.done_at ? "line-through" : "none" }}>{t.title}<span className="muted small"> {t.owner_name ?? ""}{t.due_at ? ` · due ${fmtDateTime(t.due_at, tz).slice(0, 11)}` : ""}</span></span>{!t.done_at && auth.perms.has("complaint.note.internal") && <CompleteTask taskId={t.id} />}</li>)}</ul>}
              {canAct && auth.perms.has("complaint.note.internal") && <TaskForm id={c.id} staff={staff} />}
            </section>
          )}
          {canAct && auth.perms.has("complaint.evidence.upload") && !closed && <section className="card stack"><h2>Evidence</h2><UploadForm id={c.id} /></section>}
          {canAct && auth.perms.has("ai.use") && org.aiEnabled && !(auth.perms.has("complaint.message.external") && !closed) && <section className="card stack"><h2>Assistant</h2><AiPanel id={c.id} /></section>}
          {canAct && auth.perms.has("ai.use") && !org.aiEnabled && <p className="muted small">AI assistance is switched off for this organization.</p>}
        </aside>
      </div>
    </>
  );
}
