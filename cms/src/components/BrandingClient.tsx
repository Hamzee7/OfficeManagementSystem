"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiForm, Field } from "./client";

export function BrandingForm({ brandColor, pillButtons, hasLogo, slug }: { brandColor: string; pillButtons: boolean; hasLogo: boolean; slug: string }) {
  const router = useRouter();
  const [color, setColor] = useState(brandColor);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function upload(f: File | undefined) {
    if (!f) return; setBusy(true); setErr("");
    const fd = new FormData(); fd.append("file", f);
    const res = await fetch("/api/admin/logo", { method: "POST", body: fd });
    setBusy(false);
    if (!res.ok) setErr((await res.json().catch(() => ({}))).error ?? "Upload failed."); else router.refresh();
  }
  async function removeLogo() { setBusy(true); await api("/api/admin/logo", "DELETE"); setBusy(false); router.refresh(); }

  return (
    <div className="stack">
      <ApiForm path="/api/admin/branding" resetOnSuccess={false} submitLabel="Save colours">
        <div className="row" style={{ alignItems: "flex-end" }}>
          <Field label="Brand colour" htmlFor="bc"><div className="row"><input id="bc" name="brandColor" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 56, height: 40, padding: 2 }} className="input" /><span className="mono">{color}</span></div></Field>
          <span className="btn primary" aria-hidden="true">Preview button</span>
        </div>
        <label className="check"><input type="checkbox" name="pillButtons" defaultChecked={pillButtons} />Rounded (pill-shaped) buttons</label>
      </ApiForm>
      <div className="stack">
        <h3>Logo</h3>
        {hasLogo && <div className="row"><span style={{ background: "var(--surface-2)", padding: 8, borderRadius: 8 }}>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={`/api/brand/logo?org=${slug}&v=${Date.now()}`} alt="Current logo" style={{ maxHeight: 48, maxWidth: 200 }} /></span><button className="btn sm danger" onClick={removeLogo} disabled={busy}>Remove logo</button></div>}
        <Field label={hasLogo ? "Replace logo" : "Upload logo"} hint="PNG, JPG or WebP, up to 512 KB. Wide logos about 40 pixels tall look best." htmlFor="logo"><input id="logo" type="file" className="input" accept=".png,.jpg,.jpeg,.webp" onChange={(e) => upload(e.target.files?.[0])} disabled={busy} /></Field>
        {err && <p className="field-error" role="alert">{err}</p>}
      </div>
    </div>
  );
}
