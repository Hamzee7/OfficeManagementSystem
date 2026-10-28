"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { api } from "./client";

/** Two-step sign-in management: set up, view recovery codes once, turn off. */
export function MfaPanel({ enabled, locked = false }: { enabled: boolean; locked?: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showOff, setShowOff] = useState(false);

  async function start() { setBusy(true); setErr(""); const r = await api<any>("/api/auth/mfa/setup", "POST"); setBusy(false); if (!r.ok) setErr(r.error ?? "Failed."); else setSetup(r.data); }
  async function confirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr("");
    const r = await api<{ recoveryCodes: string[] }>("/api/auth/mfa/confirm", "POST", { code: new FormData(e.currentTarget).get("code") });
    setBusy(false); if (!r.ok) setErr(r.error ?? "Failed."); else { setCodes(r.data!.recoveryCodes); setSetup(null); }
  }
  async function turnOff(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr("");
    const fd = new FormData(e.currentTarget);
    const r = await api("/api/auth/mfa/disable", "POST", { password: fd.get("password"), code: fd.get("code") });
    setBusy(false); if (!r.ok) setErr(r.error ?? "Failed."); else { setShowOff(false); router.refresh(); }
  }

  if (codes) return (
    <div className="stack" role="status">
      <div className="alert success"><strong>Two-step sign-in is on.</strong></div>
      <h3>Save your recovery codes</h3>
      <p className="muted">Each code works once if you lose your phone. They are shown only now. Store them somewhere safe, such as a password manager.</p>
      <ul className="grid g3 mono" style={{ listStyle: "none", padding: 0, margin: 0 }}>{codes.map((c) => <li key={c} className="ref-box" style={{ fontSize: 15 }}>{c}</li>)}</ul>
      <button className="btn primary" style={{ justifySelf: "start" }} onClick={() => { setCodes(null); window.location.href = "/"; }}>I have saved them</button>
    </div>
  );
  if (enabled) return (
    <div className="stack">
      <div className="alert success">Two-step sign-in is <strong>on</strong> for your account.</div>
      {!showOff ? (locked ? <p className="muted">Your organization requires two-step sign-in, so it cannot be turned off.</p> : <button className="btn danger" style={{ justifySelf: "start" }} onClick={() => setShowOff(true)}>Turn off…</button>) : (
        <form onSubmit={turnOff} className="stack">
          <div className="field"><label htmlFor="off-pw">Your password</label><input id="off-pw" name="password" type="password" className="input" autoComplete="current-password" required /></div>
          <div className="field"><label htmlFor="off-code">Current code from your app</label><input id="off-code" name="code" className="input" inputMode="numeric" autoComplete="one-time-code" required /></div>
          {err && <div className="alert error" role="alert">{err}</div>}
          <div className="row"><button className="btn danger" disabled={busy}>Turn off</button><button type="button" className="btn ghost" onClick={() => setShowOff(false)}>Cancel</button></div>
        </form>
      )}
    </div>
  );
  if (!setup) return (
    <div className="stack">
      <p className="muted">Adds a 6-digit code from an app such as Google Authenticator, Microsoft Authenticator or 1Password to your sign-in.</p>
      {err && <div className="alert error" role="alert">{err}</div>}
      <button className="btn primary" style={{ justifySelf: "start" }} onClick={start} disabled={busy}>Set up two-step sign-in</button>
    </div>
  );
  return (
    <form onSubmit={confirm} className="stack">
      <ol className="stack" style={{ margin: 0, paddingLeft: 18 }}>
        <li>Open your authenticator app and choose <em>Add account</em> then <em>Scan QR code</em>.</li>
        <li>Scan this code. <details><summary className="muted" style={{ cursor: "pointer" }}>Cannot scan? Enter the key by hand</summary><p className="ref-box" style={{ fontSize: 15 }}>{setup.secret}</p></details></li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={setup.qrSvg} alt="QR code for your authenticator app" width={200} height={200} style={{ background: "#fff", padding: 6, borderRadius: 8, justifySelf: "start" }} />
      <div className="field"><label htmlFor="mfa-code">3. Enter the 6-digit code the app shows</label><input id="mfa-code" name="code" className="input" inputMode="numeric" autoComplete="one-time-code" required style={{ maxWidth: 200 }} /></div>
      {err && <div className="alert error" role="alert">{err}</div>}
      <div className="row"><button className="btn primary" disabled={busy}>Turn on</button><button type="button" className="btn ghost" onClick={() => setSetup(null)}>Cancel</button></div>
    </form>
  );
}
