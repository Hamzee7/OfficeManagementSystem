"use client";
import { useState } from "react";
import { ApiForm, Field } from "./client";

type Opt = { id: string; name: string };

export function NewComplaintForm({ categories, departments, locations }: { categories: Opt[]; departments: Opt[]; locations: Opt[] }) {
  const [created, setCreated] = useState<{ id: string; ref: string; accessCode: string } | null>(null);
  if (created) return (
    <div className="card stack">
      <h2>Logged as {created.ref}</h2>
      <p>If the complainant gave an email they were sent the access code. Otherwise read it to them now. It is not shown again:</p>
      <span className="ref-box">{created.accessCode}</span>
      <div className="row"><a className="btn primary" href={`/complaints/${created.id}`}>Open the complaint</a><button className="btn" onClick={() => setCreated(null)}>Log another</button></div>
    </div>
  );
  return (
    <ApiForm path="/api/complaints" submitLabel="Log complaint" className="card stack" onSuccess={setCreated}
      transform={(v) => ({ ...v, incidentAt: v.incidentAt ? new Date(v.incidentAt).getTime() : null, anonymous: v.anonymous === true, consent: v.consent === true, categoryId: v.categoryId || null, departmentId: v.departmentId || null, locationId: v.locationId || null })}>
      <div className="grid g2">
        <Field label="Received via" htmlFor="ch"><select id="ch" name="channel" className="select"><option value="phone">Phone</option><option value="email">Email</option><option value="walk_in">Walk-in</option><option value="social">Social media</option><option value="web">Web</option><option value="other">Other</option></select></Field>
        <Field label="Priority" htmlFor="pr"><select id="pr" name="priority" className="select" defaultValue=""><option value="">Use the category default</option><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select></Field>
        <Field label="Complainant name" htmlFor="nm"><input id="nm" name="name" className="input" /></Field>
        <Field label="Contact method" htmlFor="cmm"><select id="cmm" name="contactMethod" className="select"><option value="email">Email</option><option value="sms">Text message</option><option value="none">None</option></select></Field>
        <Field label="Email" htmlFor="em"><input id="em" name="email" type="email" className="input" /></Field>
        <Field label="Phone" htmlFor="ph"><input id="ph" name="phone" className="input" /></Field>
      </div>
      <Field label="Title" htmlFor="ti"><input id="ti" name="title" className="input" required minLength={5} maxLength={150} /></Field>
      <Field label="Details" htmlFor="de"><textarea id="de" name="description" className="textarea" rows={6} required minLength={20} /></Field>
      <div className="grid g2">
        <Field label="Category" hint="Leave blank to let the system suggest one." htmlFor="ca"><select id="ca" name="categoryId" className="select"><option value="">Suggest for me</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Department" htmlFor="dp"><select id="dp" name="departmentId" className="select"><option value="">Not set</option>{departments.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        {locations.length > 0 && <Field label="Location" htmlFor="lo"><select id="lo" name="locationId" className="select"><option value="">Not set</option>{locations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
        <Field label="Incident date and time" htmlFor="in"><input id="in" name="incidentAt" type="datetime-local" className="input" /></Field>
        <Field label="Related reference" htmlFor="rr"><input id="rr" name="relatedRef" className="input" /></Field>
      </div>
      <label className="check"><input type="checkbox" name="anonymous" />The complainant asked to stay anonymous (contact details will not be stored)</label>
      <label className="check"><input type="checkbox" name="consent" required />The complainant has agreed to the privacy notice</label>
    </ApiForm>
  );
}
