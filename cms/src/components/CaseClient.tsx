"use client";
import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { api, ApiForm, ActionButton, Field } from "./client";

type Staff = { id: string; name: string };

export function TransitionForm({ id, version, options }: { id: string; version: number; options: { to: string; requiresComment: boolean }[] }) {
  const [to, setTo] = useState(options[0]?.to ?? "");
  if (!options.length) return <p className="muted">No status changes are available to you right now.</p>;
  const opt = options.find((o) => o.to === to);
  return (
    <ApiForm path={`/api/complaints/${id}/transition`} submitLabel="Change status" extra={{ to, expectedVersion: version }}>
      <Field label="Move to" htmlFor="t-to"><select id="t-to" className="select" value={to} onChange={(e) => setTo(e.target.value)}>{options.map((o) => <option key={o.to}>{o.to}</option>)}</select></Field>
      <Field label={opt?.requiresComment ? "Comment (required)" : "Comment (optional)"} hint={to === "Rejected" ? "This reason is shown to the complainant." : "Internal. The complainant sees only that the status changed. Use a message to tell them more."} htmlFor="t-c"><textarea id="t-c" name="comment" className="textarea" rows={2} required={opt?.requiresComment} /></Field>
    </ApiForm>
  );
}

export function AssignForm({ id, staff, currentId }: { id: string; staff: Staff[]; currentId: string | null }) {
  const [recs, setRecs] = useState<{ userId: string; name: string; score: number; reasons: string[] }[] | null>(null);
  const [user, setUser] = useState("");
  async function suggest() { const r = await api<{ ranked: any[] }>(`/api/complaints/${id}/recommendations`, "GET"); if (r.ok) setRecs(r.data!.ranked); }
  return (
    <div className="stack">
      <button type="button" className="btn sm" onClick={suggest}>Suggest the best handler</button>
      {recs && (recs.length ? (
        <ol className="stack" style={{ paddingLeft: 18, margin: 0 }}>{recs.slice(0, 4).map((r) => (
          <li key={r.userId}><button type="button" className="btn ghost sm" onClick={() => setUser(r.userId)}>{r.name}</button> <span className="muted small">{r.reasons.join(" · ")}</span></li>
        ))}</ol>
      ) : <p className="muted">No available handler. This stays in the unassigned queue.</p>)}
      {recs && <p className="hint">Suggestions only. You choose; the system never assigns around your decision.</p>}
      <ApiForm path={`/api/complaints/${id}/assign`} submitLabel={currentId ? "Reassign" : "Assign"} extra={{ userId: user }}>
        <Field label="Assign to" htmlFor="a-user"><select id="a-user" className="select" value={user} onChange={(e) => setUser(e.target.value)} required><option value="">Choose…</option>{staff.filter((s) => s.id !== currentId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label={currentId ? "Reason (required when reassigning)" : "Note (optional)"} htmlFor="a-r"><input id="a-r" className="input" name="reason" /></Field>
      </ApiForm>
    </div>
  );
}

export function NoteForm({ id }: { id: string }) {
  return (
    <ApiForm path={`/api/complaints/${id}/note`} submitLabel="Add internal note">
      <Field label="Internal note" hint="Only staff can see this. Use @name to notify a colleague." htmlFor="n-b"><textarea id="n-b" name="body" className="textarea" rows={3} required /></Field>
    </ApiForm>
  );
}

export function MessageForm({ id, draft }: { id: string; draft?: string }) {
  const [kind, setKind] = useState("update");
  const [body, setBody] = useState(draft ?? "");
  return (
    <ApiForm path={`/api/complaints/${id}/message`} submitLabel="Send to complainant" extra={{ kind, body }} onSuccess={() => setBody("")} resetOnSuccess={false}>
      <div className="alert warn small">Visible to the complainant{" "}(and emailed if they chose email). Do not include internal details.</div>
      <Field label="Type" htmlFor="m-k"><select id="m-k" className="select" value={kind} onChange={(e) => setKind(e.target.value)}><option value="update">Progress update</option><option value="request_info">Request more information (pauses the SLA)</option></select></Field>
      <Field label="Message" htmlFor="m-b"><textarea id="m-b" className="textarea" rows={4} value={body} onChange={(e) => setBody(e.target.value)} required /></Field>
    </ApiForm>
  );
}

export function ProposeForm({ id }: { id: string }) {
  return (
    <ApiForm path={`/api/complaints/${id}/propose`} submitLabel="Submit for approval">
      <Field label="Proposed resolution" hint="This is what the complainant will be told once a manager approves it." htmlFor="p-t"><textarea id="p-t" name="text" className="textarea" rows={4} required minLength={10} /></Field>
    </ApiForm>
  );
}

export function ApprovalForm({ approvalId, proposed }: { approvalId: string; proposed: string }) {
  const [comment, setComment] = useState("");
  return (
    <div className="stack">
      <div className="details" style={{ whiteSpace: "pre-wrap", background: "var(--surface-2)", borderRadius: 8, padding: 10 }}>{proposed}</div>
      <Field label="Decision comment" hint="Required if you reject." htmlFor="ap-c"><textarea id="ap-c" className="textarea" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      <div className="row">
        <ActionButton path={`/api/approvals/${approvalId}`} body={{ approve: true, comment }} className="btn primary">Approve and resolve</ActionButton>
        <ActionButton path={`/api/approvals/${approvalId}`} body={{ approve: false, comment }} className="btn danger">Reject</ActionButton>
      </div>
    </div>
  );
}

export function TaskForm({ id, staff }: { id: string; staff: Staff[] }) {
  return (
    <ApiForm path={`/api/complaints/${id}/task`} submitLabel="Add task" transform={(v) => ({ title: v.title, ownerId: v.ownerId || null, dueAt: v.due ? new Date(v.due).getTime() : null })}>
      <Field label="Task" htmlFor="tk-t"><input id="tk-t" name="title" className="input" required minLength={3} /></Field>
      <div className="grid g2">
        <Field label="Owner" htmlFor="tk-o"><select id="tk-o" name="ownerId" className="select"><option value="">Unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Due" htmlFor="tk-d"><input id="tk-d" name="due" type="date" className="input" /></Field>
      </div>
    </ApiForm>
  );
}

export function UploadForm({ id }: { id: string }) {
  const router = useRouter();
  const [vis, setVis] = useState("internal");
  const [pct, setPct] = useState<number | null>(null);
  const [err, setErr] = useState("");
  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData(); fd.append("file", f); fd.append("visibility", vis);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/complaints/${id}/evidence`);
    xhr.upload.onprogress = (ev) => ev.lengthComputable && setPct(Math.round((ev.loaded / ev.total) * 100));
    xhr.onload = () => { setPct(null); if (xhr.status >= 300) setErr(JSON.parse(xhr.responseText || "{}").error ?? "Upload failed."); else { setErr(""); router.refresh(); } };
    xhr.onerror = () => { setPct(null); setErr("Upload failed. Check your connection."); };
    setErr(""); setPct(0); xhr.send(fd); e.target.value = "";
  }
  return (
    <div className="stack">
      <Field label="Visible to" htmlFor="u-v"><select id="u-v" className="select" value={vis} onChange={(e) => setVis(e.target.value)}><option value="internal">Staff only</option><option value="public">Staff and complainant</option></select></Field>
      <Field label="Add evidence" hint="PNG, JPG, GIF, WebP, PDF, TXT, DOCX or XLSX, up to 10 MB." htmlFor="u-f"><input id="u-f" type="file" className="input" onChange={onFile} accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.log,.docx,.xlsx" /></Field>
      {pct !== null && <div className="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress"><i style={{ width: `${pct}%` }} /></div>}
      {err && <p className="field-error" role="alert">{err}</p>}
    </div>
  );
}

export function AiPanel({ id, onDraft }: { id: string; onDraft?: (t: string) => void }) {
  const [out, setOut] = useState<any>(null);
  const [kind, setKind] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(k: string) {
    setBusy(true); setErr(""); setKind(k);
    const r = await api(`/api/complaints/${id}/ai`, "POST", { kind: k });
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? "Failed."); setOut(null); } else { setOut(r.data); if (k.startsWith("draft_") && onDraft) onDraft(r.data.text); }
  }
  async function decide(accept: boolean) { await api(`/api/ai/${out.id}`, "POST", { accept }); setOut({ ...out, decided: accept ? "accepted" : "rejected" }); }
  return (
    <div className="stack">
      <div className="chips">
        {[["summary", "Summarise"], ["draft_update", "Draft update"], ["draft_request_info", "Draft info request"], ["draft_resolution", "Draft resolution"], ["duplicates", "Find similar"], ["knowledge", "Suggest articles"]].map(([k, l]) => (
          <button key={k} type="button" className="btn sm" disabled={busy} onClick={() => run(k)}>{l}</button>
        ))}
      </div>
      {err && <p className="alert error" role="alert">{err} You can still do everything manually.</p>}
      {out && (
        <div className="stack" role="status">
          <span className="badge plain pill-internal">Suggestion from {out.provider}. Not verified.</span>
          {out.text && <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit" }}>{out.text}</pre>}
          {out.sentiment && <p className="hint">Tone: {out.sentiment.tone}. {out.sentiment.note}</p>}
          {out.matches && (out.matches.length ? <ul>{out.matches.map((m: any) => <li key={m.id}><strong>{m.ref}</strong> · {Math.round(m.similarity * 100)}% similar. {m.rationale} <ActionButton path={`/api/complaints/${id}/link`} body={{ otherId: m.id }} className="btn sm">Link records</ActionButton></li>)}</ul> : <p className="muted">No similar complaints found.</p>)}
          {out.articles && (out.articles.length ? <ul>{out.articles.map((a: any) => <li key={a.id}>{a.title}</li>)}</ul> : <p className="muted">No matching articles.</p>)}
          {out.note && <p className="hint">{out.note}</p>}
          {out.decided ? <p className="muted">You {out.decided} this suggestion. This was recorded.</p> : <div className="row"><button type="button" className="btn sm" onClick={() => decide(true)}>Useful</button><button type="button" className="btn ghost sm" onClick={() => decide(false)}>Not useful</button></div>}
        </div>
      )}
      <p className="hint">Rule-based assistance that runs on this server. It never sends messages, changes a complaint, or decides an outcome.</p>
      <span className="sr-only">{kind}</span>
    </div>
  );
}

export function DraftingMessage({ id }: { id: string }) {
  const [draft, setDraft] = useState("");
  const [key, setKey] = useState(0);
  return (
    <div className="stack">
      <AiPanel id={id} onDraft={(t) => { setDraft(t); setKey((k) => k + 1); }} />
      <MessageForm key={key} id={id} draft={draft} />
    </div>
  );
}

export function CompleteTask({ taskId }: { taskId: string }) {
  return <ActionButton path={`/api/tasks/${taskId}/complete`} className="btn sm">Done</ActionButton>;
}
