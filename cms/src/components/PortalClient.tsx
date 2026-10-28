"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "./client";

type Opt = { id: string; name: string };
type Options = { org: { name: string; slug: string; allowAnonymous: boolean }; categories: Opt[]; departments: Opt[]; locations: Opt[] };

const DRAFT_KEY = "cms-submit-draft-v1";
const blank = { who: "contact" as "contact" | "anonymous", name: "", email: "", phone: "", contactMethod: "email", title: "", description: "", categoryId: "", departmentId: "", locationId: "", incidentAt: "", relatedRef: "", channel: "web", consent: false, website: "" };

export function SubmitWizard({ options }: { options: Options }) {
  const [step, setStep] = useState(0);
  const [v, setV] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ ref: string; accessCode: string } | null>(null);
  const [restored, setRestored] = useState(false);
  const head = useRef<HTMLHeadingElement>(null);

  // Autosave locally so a refresh or a back-and-forth never loses what was typed. The consent box is never restored.
  useEffect(() => { try { const s = localStorage.getItem(DRAFT_KEY); if (s) { setV({ ...blank, ...JSON.parse(s), consent: false }); setRestored(true); } } catch {} }, []);
  useEffect(() => { if (!done) try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...v, consent: false })); } catch {} }, [v, done]);
  useEffect(() => { head.current?.focus(); }, [step, done]);

  const set = (k: keyof typeof blank, val: string | boolean) => { setV((p) => ({ ...p, [k]: val })); setErrors((e) => ({ ...e, [k]: "" })); };
  const anon = v.who === "anonymous";

  function validate(s: number): Record<string, string> {
    const e: Record<string, string> = {};
    if (s === 0 && !anon) {
      if (v.contactMethod === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email.trim())) e.email = "Enter an email address like name@example.com, or choose not to be contacted.";
      if (v.contactMethod === "sms" && v.phone.trim().length < 6) e.phone = "Enter a phone number we can text.";
    }
    if (s === 1) {
      if (v.title.trim().length < 5) e.title = "Give your complaint a short title (at least 5 characters).";
      if (v.description.trim().length < 20) e.description = `Please tell us a little more (${Math.max(0, 20 - v.description.trim().length)} more characters).`;
      if (v.incidentAt && new Date(v.incidentAt).getTime() > Date.now()) e.incidentAt = "The date of the incident cannot be in the future.";
    }
    if (s === 2 && !v.consent) e.consent = "Please confirm you have read the privacy notice.";
    return e;
  }
  function next() { const e = validate(step); setErrors(e); if (!Object.keys(e).length) setStep(step + 1); }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const e = validate(2); setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true); setServerError("");
    const r = await api<{ ref: string; accessCode: string }>("/api/portal/submit", "POST", {
      org: options.org.slug, title: v.title, description: v.description, categoryId: v.categoryId || null, departmentId: v.departmentId || null, locationId: v.locationId || null,
      incidentAt: v.incidentAt ? new Date(v.incidentAt).getTime() : null, relatedRef: v.relatedRef || null, channel: "web", anonymous: anon,
      name: anon ? null : v.name || null, email: anon ? null : v.email || null, phone: anon ? null : v.phone || null, contactMethod: anon ? "none" : v.contactMethod, consent: v.consent, website: v.website,
    });
    setBusy(false);
    if (!r.ok) { setServerError(r.error ?? "We could not send your complaint."); return; }
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    setDone(r.data!);
  }

  if (done) return <Confirmation done={done} anonymous={anon} hasEmail={!anon && v.contactMethod === "email"} headRef={head} />;

  const steps = ["About you", "What happened", "Review and send"];
  return (
    <form onSubmit={submit} className="card stack-lg" noValidate>
      <ol className="steps" aria-label="Progress">
        {steps.map((s, i) => <li key={s} className={i < step ? "done" : ""} aria-current={i === step ? "step" : undefined}>{i < step ? "✓ " : `${i + 1}. `}{s}</li>)}
      </ol>
      <h2 tabIndex={-1} ref={head}>{steps[step]}</h2>
      {restored && step === 0 && <div className="alert info">We restored what you had typed earlier on this device. <button type="button" className="btn ghost sm" onClick={() => { setV(blank); setRestored(false); try { localStorage.removeItem(DRAFT_KEY); } catch {} }}>Start fresh</button></div>}

      {step === 0 && (
        <div className="stack">
          <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label">How would you like to submit?</legend>
            <label className="check"><input type="radio" name="who" checked={!anon} onChange={() => set("who", "contact")} /><span><strong>With my contact details</strong><br /><span className="hint">We can send you updates and ask questions.</span></span></label>
            {options.org.allowAnonymous && <label className="check"><input type="radio" name="who" checked={anon} onChange={() => set("who", "anonymous")} /><span><strong>Anonymously</strong><br /><span className="hint">We store no name or contact details. You will not receive emails or texts, and we can only ask you questions if you check the tracking page with your access code.</span></span></label>}
          </fieldset>
          {!anon && (
            <>
              <div className="field"><label htmlFor="name">Your name (optional)</label><input id="name" className="input" autoComplete="name" value={v.name} onChange={(e) => set("name", e.target.value)} /></div>
              <div className="field"><label htmlFor="cm">How should we contact you?</label>
                <select id="cm" className="select" value={v.contactMethod} onChange={(e) => set("contactMethod", e.target.value)}><option value="email">Email</option><option value="sms">Text message</option><option value="none">Do not contact me. I will check the tracking page</option></select></div>
              {v.contactMethod === "email" && <div className="field"><label htmlFor="email">Email address</label><input id="email" type="email" className="input" autoComplete="email" value={v.email} onChange={(e) => set("email", e.target.value)} aria-invalid={!!errors.email} aria-describedby="email-e" /><span id="email-e" className="field-error" role="alert">{errors.email}</span></div>}
              {v.contactMethod === "sms" && <div className="field"><label htmlFor="phone">Mobile number</label><input id="phone" type="tel" className="input" autoComplete="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} aria-invalid={!!errors.phone} aria-describedby="phone-e" /><span id="phone-e" className="field-error" role="alert">{errors.phone}</span><span className="hint">Text messages need a provider to be set up by the organization. If they are not, we will email or you can track online.</span></div>}
            </>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="stack">
          <div className="field"><label htmlFor="title">Short title</label><input id="title" className="input" maxLength={150} value={v.title} onChange={(e) => set("title", e.target.value)} aria-invalid={!!errors.title} aria-describedby="title-e" placeholder="e.g. Machine keeps jamming after service" /><span id="title-e" className="field-error" role="alert">{errors.title}</span></div>
          <div className="field"><label htmlFor="desc">What happened?</label><textarea id="desc" className="textarea" rows={7} value={v.description} onChange={(e) => set("description", e.target.value)} aria-invalid={!!errors.description} aria-describedby="desc-e" placeholder="Describe what happened, who was involved and what you would like us to do." /><span id="desc-e" className="field-error" role="alert">{errors.description}</span><span className="hint">{v.description.trim().length} characters. Please do not include passwords or payment card numbers.</span></div>
          <div className="grid g2">
            <div className="field"><label htmlFor="cat">Category</label><select id="cat" className="select" value={v.categoryId} onChange={(e) => set("categoryId", e.target.value)}><option value="">Not sure. Help me choose</option>{options.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            {options.departments.length > 1 && <div className="field"><label htmlFor="dep">Department involved</label><select id="dep" className="select" value={v.departmentId} onChange={(e) => set("departmentId", e.target.value)}><option value="">Not sure</option>{options.departments.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
            {options.locations.length > 0 && <div className="field"><label htmlFor="loc">Location or branch</label><select id="loc" className="select" value={v.locationId} onChange={(e) => set("locationId", e.target.value)}><option value="">Not sure</option>{options.locations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
            <div className="field"><label htmlFor="when">When did it happen? (optional)</label><input id="when" type="datetime-local" className="input" value={v.incidentAt} max={new Date().toISOString().slice(0, 16)} onChange={(e) => set("incidentAt", e.target.value)} aria-invalid={!!errors.incidentAt} /><span className="field-error" role="alert">{errors.incidentAt}</span></div>
            <div className="field"><label htmlFor="rel">Order, account or invoice number (optional)</label><input id="rel" className="input" value={v.relatedRef} onChange={(e) => set("relatedRef", e.target.value)} /></div>
          </div>
          <p className="hint">You can add photos or documents after sending.</p>
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <dl className="kv" style={{ gridTemplateColumns: "130px 1fr" }}>
            <dt>Contact</dt><dd>{anon ? "Anonymous (no contact details stored)" : `${v.name || "No name given"} · ${v.contactMethod === "email" ? v.email : v.contactMethod === "sms" ? v.phone : "no contact"}`}</dd>
            <dt>Title</dt><dd>{v.title}</dd>
            <dt>Details</dt><dd style={{ whiteSpace: "pre-wrap" }}>{v.description}</dd>
            <dt>Category</dt><dd>{options.categories.find((c) => c.id === v.categoryId)?.name ?? "We will choose one for you"}</dd>
          </dl>
          <div className="alert info"><strong>Privacy.</strong> {options.org.name} will use what you send only to look into your complaint. Staff who handle it can see it. {anon ? "Because you chose anonymous, we keep no name or contact details." : "Your contact details are visible only to staff who need them."} It is kept for the period set by the organization&apos;s retention policy.</div>
          <label className="check"><input type="checkbox" checked={v.consent} onChange={(e) => set("consent", e.target.checked)} aria-invalid={!!errors.consent} /><span>I have read the privacy notice and agree that {options.org.name} may process this complaint.</span></label>
          <span className="field-error" role="alert">{errors.consent}</span>
          <div className="hp" aria-hidden="true"><label>Leave this empty<input tabIndex={-1} autoComplete="off" value={v.website} onChange={(e) => set("website", e.target.value)} /></label></div>
          {serverError && <div className="alert error" role="alert">{serverError}</div>}
        </div>
      )}

      <div className="row-between">
        {step > 0 ? <button type="button" className="btn" onClick={() => setStep(step - 1)}>Back</button> : <span />}
        {step < 2 ? <button type="button" className="btn primary" onClick={next}>Continue</button> : <button className="btn primary" disabled={busy}>{busy ? "Sending…" : "Send complaint"}</button>}
      </div>
    </form>
  );
}

function Confirmation({ done, anonymous, hasEmail, headRef }: { done: { ref: string; accessCode: string }; anonymous: boolean; hasEmail: boolean; headRef: React.RefObject<HTMLHeadingElement | null> }) {
  const [copied, setCopied] = useState("");
  const [files, setFiles] = useState<{ name: string; pct: number; error?: string; ok?: boolean }[]>([]);
  async function copy(t: string, k: string) { try { await navigator.clipboard.writeText(t); setCopied(k); } catch { setCopied("select"); } }
  function upload(list: FileList | null) {
    if (!list) return;
    Array.from(list).forEach((f) => {
      const idx = files.length;
      setFiles((p) => [...p, { name: f.name, pct: 0 }]);
      const fd = new FormData(); fd.append("file", f); fd.append("ref", done.ref); fd.append("code", done.accessCode);
      const x = new XMLHttpRequest(); x.open("POST", "/api/portal/upload");
      x.upload.onprogress = (e) => e.lengthComputable && setFiles((p) => p.map((q) => q.name === f.name ? { ...q, pct: Math.round((e.loaded / e.total) * 100) } : q));
      x.onload = () => setFiles((p) => p.map((q) => q.name === f.name ? (x.status < 300 ? { ...q, pct: 100, ok: true } : { ...q, error: JSON.parse(x.responseText || "{}").error ?? "Upload failed." }) : q));
      x.onerror = () => setFiles((p) => p.map((q) => q.name === f.name ? { ...q, error: "Upload failed. Check your connection." } : q));
      void idx; x.send(fd);
    });
  }
  return (
    <section className="card stack-lg" aria-live="polite">
      <div className="stack">
        <h2 tabIndex={-1} ref={headRef}>Thank you. We have your complaint.</h2>
        <p>Keep these two items. You need <strong>both</strong> to check progress, add information or reopen the complaint. The access code is shown only once.</p>
      </div>
      <div className="grid g2">
        <div className="stack"><span className="label">Reference</span><span className="ref-box">{done.ref}</span><button type="button" className="btn sm" onClick={() => copy(done.ref, "ref")}>{copied === "ref" ? "Copied" : "Copy"}</button></div>
        <div className="stack"><span className="label">Access code (private)</span><span className="ref-box">{done.accessCode}</span><button type="button" className="btn sm" onClick={() => copy(done.accessCode, "code")}>{copied === "code" ? "Copied" : "Copy"}</button></div>
      </div>
      {copied === "select" && <p className="hint">Copying was blocked by your browser. Select the text above and copy it manually.</p>}
      <div className="alert info">{hasEmail ? "We also emailed you a confirmation. " : ""}{anonymous ? "Because you chose to stay anonymous, we cannot email you. Please write these down. " : ""}Anyone with the code can see this complaint, so do not share it.</div>
      <div className="stack">
        <h3>Add photos or documents (optional)</h3>
        <input type="file" multiple className="input" accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.docx,.xlsx" onChange={(e) => upload(e.target.files)} aria-label="Choose files to upload" />
        <span className="hint">PNG, JPG, GIF, WebP, PDF, TXT, DOCX or XLSX, up to 10 MB each.</span>
        {files.map((f) => (<div key={f.name} className="row-between"><span>{f.name}</span>{f.error ? <span className="field-error" role="alert">{f.error}</span> : f.ok ? <span className="badge st-Resolved">Uploaded</span> : <span className="meter" style={{ width: 120 }} role="progressbar" aria-valuenow={f.pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${f.pct}%` }} /></span>}</div>))}
      </div>
      <a className="btn primary" href="/track" style={{ justifySelf: "start" }}>Go to complaint tracking</a>
    </section>
  );
}

// ------------------------------------------------------------------------------------------------ tracking

type View = {
  ref: string; title: string; status: string; createdAt: number; updatedAt: number; resolution: string | null; respondBy: number | null;
  waitingForYou: boolean; canReopen: boolean; canGiveFeedback: boolean; feedbackGiven: boolean;
  events: { type: string; from: string; body: string | null; at: number }[]; attachments: { id: string; filename: string; size: number; url: string }[];
};

export function TrackClient() {
  const [ref, setRef] = useState("");
  const [code, setCode] = useState("");
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState("");
  const [rating, setRating] = useState(0);
  const [fb, setFb] = useState("");
  const [reason, setReason] = useState("");
  const [showReopen, setShowReopen] = useState(false);

  async function load(e?: FormEvent) {
    e?.preventDefault(); setBusy(true); setError("");
    const r = await api<View>("/api/portal/track", "POST", { ref: ref.trim(), code: code.trim() });
    setBusy(false);
    if (!r.ok) { setError(r.error ?? "Could not load that complaint."); setView(null); } else setView(r.data!);
  }
  async function act(path: string, body: object, ok: string) {
    setBusy(true); setNote("");
    const r = await api(path, "POST", { ref: ref.trim(), code: code.trim(), ...body });
    setBusy(false);
    if (!r.ok) { setNote(r.error ?? "Failed."); return; }
    setNote(ok); await load();
  }
  function upload(list: FileList | null) {
    const f = list?.[0]; if (!f) return;
    const fd = new FormData(); fd.append("file", f); fd.append("ref", ref.trim()); fd.append("code", code.trim());
    const x = new XMLHttpRequest(); x.open("POST", "/api/portal/upload");
    x.onload = () => { if (x.status < 300) { setNote("File uploaded."); load(); } else setNote(JSON.parse(x.responseText || "{}").error ?? "Upload failed."); };
    x.onerror = () => setNote("Upload failed. Check your connection."); x.send(fd);
  }

  if (!view) return (
    <form onSubmit={load} className="card stack">
      <h2>Check on a complaint</h2>
      <p className="muted">Enter the reference and the access code you were given when you submitted it.</p>
      <div className="field"><label htmlFor="ref">Reference</label><input id="ref" className="input mono" placeholder="CMP-2026-000123" value={ref} onChange={(e) => setRef(e.target.value)} autoComplete="off" required /></div>
      <div className="field"><label htmlFor="code">Access code</label><input id="code" className="input mono" placeholder="ABCD-EFGH-JKMN" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" required /></div>
      {error && <div className="alert error" role="alert">{error}</div>}
      <button className="btn primary" disabled={busy} style={{ justifySelf: "start" }}>{busy ? "Checking…" : "Show my complaint"}</button>
    </form>
  );
  const closed = view.status === "Closed" || view.status === "Rejected";
  return (
    <div className="stack-lg">
      <section className="card stack">
        <div className="row"><span className="mono muted">{view.ref}</span><span className={`badge st-${view.status.replace(/\s+/g, "-")}`}>{view.status}</span></div>
        <h2>{view.title}</h2>
        <p className="muted">Submitted {new Date(view.createdAt).toLocaleString()}{view.respondBy && !closed ? ` · we aim to respond by ${new Date(view.respondBy).toLocaleString()}` : ""}</p>
        {view.waitingForYou && <div className="alert warn"><strong>We are waiting for your reply.</strong> Please answer our last question below so we can continue.</div>}
        {view.resolution && <div className="alert success"><strong>Outcome.</strong><br /><span style={{ whiteSpace: "pre-wrap" }}>{view.resolution}</span></div>}
        <button type="button" className="btn sm" style={{ justifySelf: "start" }} onClick={() => { setView(null); setCode(""); }}>Close this view</button>
      </section>

      <section className="card stack" aria-label="History">
        <h2>History</h2>
        <ol className="timeline">{[...view.events].reverse().map((e, i) => (
          <li key={i} className="tl-item"><div className="tl-icon" aria-hidden="true">{e.from.slice(0, 1)}</div><div className="tl-body"><div className="tl-meta"><strong>{e.from}</strong> · {new Date(e.at).toLocaleString()}</div>{e.body && <div className="tl-text">{e.body}</div>}</div></li>
        ))}</ol>
      </section>

      {view.attachments.length > 0 && <section className="card stack"><h2>Files</h2><ul>{view.attachments.map((a) => <li key={a.id}><a href={a.url}>{a.filename}</a> <span className="muted small">{Math.round(a.size / 1024)} KB</span></li>)}</ul></section>}

      {!closed && (
        <section className="card stack">
          <h2>Send us a message</h2>
          <div className="field"><label htmlFor="m">Message</label><textarea id="m" className="textarea" rows={4} value={msg} onChange={(e) => setMsg(e.target.value)} /></div>
          <div className="row"><button className="btn primary" disabled={busy || !msg.trim()} onClick={async () => { await act("/api/portal/message", { body: msg }, "Message sent."); setMsg(""); }}>Send message</button>
            <label className="btn">Attach a file<input type="file" className="sr-only" onChange={(e) => upload(e.target.files)} accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.docx,.xlsx" /></label></div>
        </section>
      )}

      {view.canReopen && (
        <section className="card stack"><h2>Not happy with the outcome?</h2>
          {!showReopen ? <button className="btn" style={{ justifySelf: "start" }} onClick={() => setShowReopen(true)}>Ask us to reopen this complaint</button> : (
            <><div className="field"><label htmlFor="rr">What is still wrong?</label><textarea id="rr" className="textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
              <button className="btn primary" disabled={busy || reason.trim().length < 3} style={{ justifySelf: "start" }} onClick={() => act("/api/portal/reopen", { reason }, "We have reopened your complaint.")}>Reopen complaint</button></>
          )}
        </section>
      )}

      {view.canGiveFeedback && (
        <section className="card stack"><h2>How did we do?</h2>
          <div role="radiogroup" aria-label="Rating out of 5" className="row">{[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={rating === n} className={`btn ${rating === n ? "primary" : ""}`} onClick={() => setRating(n)}>{n}</button>)}<span className="muted small">1 = very poor, 5 = excellent</span></div>
          <div className="field"><label htmlFor="fb">Comments (optional)</label><textarea id="fb" className="textarea" rows={2} value={fb} onChange={(e) => setFb(e.target.value)} /></div>
          <button className="btn primary" disabled={busy || !rating} style={{ justifySelf: "start" }} onClick={() => act("/api/portal/feedback", { rating, comment: fb }, "Thank you for your feedback.")}>Send feedback</button>
        </section>
      )}
      {view.feedbackGiven && <p className="muted">Thank you for your feedback.</p>}
      {note && <div className="alert info" role="status">{note}</div>}
    </div>
  );
}
