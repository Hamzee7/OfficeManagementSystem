"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiForm } from "./client";
import { STATUSES } from "@/lib/workflow";

/** Bulk actions bar. Reads the checked rows (they belong to the form with id "bulk-form"). */
export function BulkBar({ staff, canAssign }: { staff: { id: string; name: string }[]; canAssign: boolean }) {
  const router = useRouter();
  const [action, setAction] = useState<"assign" | "transition">(canAssign ? "assign" : "transition");
  const [userId, setUserId] = useState("");
  const [to, setTo] = useState("Investigation in Progress");
  const [comment, setComment] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "success"; text: string; details?: string[] } | null>(null);

  async function run() {
    const ids = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="ids"]:checked')).map((i) => i.value);
    if (!ids.length) { setMsg({ kind: "error", text: "Tick at least one complaint first." }); return; }
    setBusy(true); setMsg(null);
    const r = await api<{ results: { ref?: string; ok: boolean; error?: string }[]; succeeded: number; failed: number }>("/api/complaints/bulk", "POST", { ids, action, userId: userId || undefined, to: action === "transition" ? to : undefined, comment: comment || undefined, confirm });
    setBusy(false);
    if (!r.ok) { setMsg({ kind: "error", text: r.error ?? "Failed." }); return; }
    const failures = r.data!.results.filter((x) => !x.ok).map((x) => `${x.ref}: ${x.error}`);
    setMsg({ kind: r.data!.failed ? "error" : "success", text: `${r.data!.succeeded} updated, ${r.data!.failed} skipped.`, details: failures });
    setConfirm(false);
    router.refresh();
  }
  return (
    <form id="bulk-form" className="card stack" onSubmit={(e) => { e.preventDefault(); run(); }} aria-label="Bulk actions">
      <h2>Bulk action on ticked complaints</h2>
      <div className="row" style={{ alignItems: "flex-end" }}>
        <div className="field"><label htmlFor="b-action">Action</label>
          <select id="b-action" className="select" value={action} onChange={(e) => setAction(e.target.value as any)}>{canAssign && <option value="assign">Assign to</option>}<option value="transition">Change status to</option></select></div>
        {action === "assign" ? (
          <div className="field"><label htmlFor="b-user">Person</label><select id="b-user" className="select" value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Choose…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        ) : (
          <div className="field"><label htmlFor="b-to">Status</label><select id="b-to" className="select" value={to} onChange={(e) => setTo(e.target.value)}>{STATUSES.filter((s) => s !== "Draft" && s !== "Resolved").map((s) => <option key={s}>{s}</option>)}</select></div>
        )}
        <div className="field" style={{ flex: "1 1 220px" }}><label htmlFor="b-comment">Comment</label><input id="b-comment" className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Required for some changes" /></div>
        <label className="check"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />I confirm this change to all ticked complaints</label>
        <button className="btn primary" disabled={busy || !confirm}>{busy ? "Working…" : "Apply"}</button>
      </div>
      {msg && <div role="status" className={`alert ${msg.kind}`}>{msg.text}{msg.details && msg.details.length > 0 && <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{msg.details.map((d) => <li key={d}>{d}</li>)}</ul>}</div>}
      <p className="hint">Each complaint is checked exactly as if you changed it one by one. Anything not allowed is skipped and listed here. Approval-gated steps (such as resolving) cannot be done in bulk.</p>
    </form>
  );
}

export function SaveView({ qs }: { qs: string }) {
  return (
    <details>
      <summary className="muted" style={{ cursor: "pointer" }}>Save this filter as a view</summary>
      <ApiForm path="/api/saved-views" submitLabel="Save view" extra={{ filters: { kind: "view", qs } }} className="row">
        <input className="input" name="name" placeholder="View name" aria-label="View name" required style={{ maxWidth: 260 }} />
      </ApiForm>
    </details>
  );
}
