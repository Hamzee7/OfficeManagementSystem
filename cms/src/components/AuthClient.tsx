"use client";
import { useState, type FormEvent } from "react";
import { api } from "./client";

export function LoginForm() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError("");
    const fd = new FormData(e.currentTarget);
    const r = await api("/api/auth/login", "POST", { email: fd.get("email"), password: fd.get("password") });
    if (!r.ok) { setBusy(false); setError(r.error ?? "Could not sign in."); return; }
    window.location.href = "/";
  }
  return (
    <form onSubmit={submit} className="stack">
      <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" className="input" autoComplete="username" required /></div>
      <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" className="input" autoComplete="current-password" required /></div>
      {error && <div className="alert error" role="alert">{error}</div>}
      <button className="btn primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
