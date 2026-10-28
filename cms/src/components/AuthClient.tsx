"use client";
import { useState, type FormEvent } from "react";
import { api } from "./client";

export function LoginForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError("");
    const fd = new FormData(e.currentTarget);
    if (challenge) {
      const r = await api("/api/auth/mfa", "POST", { challenge, code: fd.get("code") });
      if (!r.ok) { setBusy(false); setError(r.error ?? "Could not sign in."); if (/timed out/.test(r.error ?? "")) setChallenge(null); return; }
      window.location.href = "/"; return;
    }
    const r = await api<{ mfaRequired?: boolean; challenge?: string }>("/api/auth/login", "POST", { email: fd.get("email"), password: fd.get("password") });
    if (!r.ok) { setBusy(false); setError(r.error ?? "Could not sign in."); return; }
    if (r.data?.mfaRequired) { setBusy(false); setChallenge(r.data.challenge!); return; }
    window.location.href = "/";
  }
  if (challenge) return (
    <form onSubmit={submit} className="stack">
      <div className="field"><label htmlFor="code">Authentication code</label><input id="code" name="code" className="input" inputMode="numeric" autoComplete="one-time-code" autoFocus required placeholder="123456" /><span className="hint">Open your authenticator app and enter the 6-digit code. Lost your phone? Enter one of your recovery codes instead.</span></div>
      {error && <div className="alert error" role="alert">{error}</div>}
      <button className="btn primary" disabled={busy}>{busy ? "Checking…" : "Verify and sign in"}</button>
      <button type="button" className="btn ghost" onClick={() => { setChallenge(null); setError(""); }}>Back</button>
    </form>
  );
  return (
    <form onSubmit={submit} className="stack">
      <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" className="input" autoComplete="username" required /></div>
      <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" className="input" autoComplete="current-password" required /></div>
      {error && <div className="alert error" role="alert">{error}</div>}
      <button className="btn primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
