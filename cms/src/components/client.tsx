"use client";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";

export async function api<T = any>(path: string, method: string, body?: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: json.error ?? `Request failed (${res.status}).` };
    return { ok: true, data: json };
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }
}

/** A button that calls the API, shows progress and any error, then refreshes the page data. */
export function ActionButton({ path, method = "POST", body, children, className = "btn", confirm, onDone, disabled }: { path: string; method?: string; body?: unknown; children: ReactNode; className?: string; confirm?: string; onDone?: (d: any) => void; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [armed, setArmed] = useState(false);
  async function run() {
    if (confirm && !armed) { setArmed(true); return; }
    setBusy(true); setErr("");
    const r = await api(path, method, body);
    setBusy(false); setArmed(false);
    if (!r.ok) setErr(r.error ?? "Failed."); else { onDone?.(r.data); router.refresh(); }
  }
  return (
    <span>
      <button type="button" className={className} onClick={run} disabled={busy || disabled}>{busy ? "Working…" : armed ? `${confirm} – click again` : children}</button>
      {err && <span className="field-error" role="alert"> {err}</span>}
    </span>
  );
}

/** Named request shapers. Server pages pass the *name* (a string); functions cannot cross the server/client boundary. */
const TRANSFORMS: Record<string, (v: Record<string, any>) => Record<string, any>> = {
  kb: (v) => ({ ...v, tags: [], published: v.published === true }),
  user: (v) => ({ ...v, departmentId: v.departmentId || null }),
  category: (v) => ({ ...v, sensitive: v.sensitive === true, active: v.active === undefined ? true : v.active === true, departmentId: v.departmentId || null, keywords: String(v.keywords ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) }),
  workflow: (v) => ({ from: v.from, to: v.to, requiresComment: v.requiresComment === true, requiresEvidence: v.requiresEvidence === true, enabled: v.enabled === true }),
  roles: (v) => ({ id: v.id, name: v.name, description: v.description, permissions: ([] as string[]).concat(v.permissions ?? []) }),
  settings: (v) => ({ name: v.name, timezone: v.timezone, workStart: v.workStart, workEnd: v.workEnd, workDays: ([] as any[]).concat(v.workDays ?? []).map(Number), allowAnonymous: v.allowAnonymous === true, aiEnabled: v.aiEnabled === true, assignmentStrategy: v.assignmentStrategy, atRiskPct: v.atRiskPct, criticalUnassignedMinutes: v.criticalUnassignedMinutes, reopenThreshold: v.reopenThreshold, retentionDays: v.retentionDays }),
};

/** Generic JSON form: collects named fields, posts them, shows validation errors in plain language. */
export function ApiForm({ path, method = "POST", children, submitLabel = "Save", extra, onSuccess, resetOnSuccess = true, className = "stack", transform }: { path: string; method?: string; children: ReactNode; submitLabel?: string; extra?: Record<string, unknown>; onSuccess?: (d: any) => void; resetOnSuccess?: boolean; className?: string; transform?: keyof typeof TRANSFORMS | ((v: Record<string, any>) => Record<string, any>) }) {
  const router = useRouter();
  const [state, setState] = useState<{ busy: boolean; error: string; ok: boolean }>({ busy: false, error: "", ok: false });
  const [, start] = useTransition();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const values: Record<string, any> = { ...extra };
    for (const el of Array.from(form.elements) as HTMLInputElement[]) {
      if (!el.name) continue;
      if (el.type === "checkbox") { const group = form.querySelectorAll(`input[type=checkbox][name="${el.name}"]`); if (group.length > 1) { values[el.name] = fd.getAll(el.name); } else values[el.name] = el.checked; }
      else if (el.type === "number") values[el.name] = el.value === "" ? undefined : Number(el.value);
      else if (el.type === "radio") { if (el.checked) values[el.name] = el.value; }
      else values[el.name] = el.value === "" ? undefined : el.value;
    }
    setState({ busy: true, error: "", ok: false });
    const shape = typeof transform === "string" ? TRANSFORMS[transform] : transform;
    const r = await api(path, method, shape ? shape(values) : values);
    if (!r.ok) { setState({ busy: false, error: r.error ?? "Failed.", ok: false }); return; }
    setState({ busy: false, error: "", ok: true });
    if (resetOnSuccess) form.reset();
    onSuccess?.(r.data);
    start(() => router.refresh());
  }
  return (
    <form onSubmit={submit} className={className}>
      {children}
      <div className="row">
        <button className="btn primary" disabled={state.busy}>{state.busy ? "Saving…" : submitLabel}</button>
        {state.ok && <span className="muted" role="status">Saved.</span>}
        {state.error && <span className="field-error" role="alert">{state.error}</span>}
      </div>
    </form>
  );
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}
