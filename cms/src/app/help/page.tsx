export const metadata = { title: "Help and support" };

export default function Help() {
  return (
    <main className="portal-main">
      <h1>Help and support</h1>
      <section className="card stack"><h2>Reporting a problem</h2><p>You do not need an account. Use <a href="/submit">Submit a complaint</a>. You will get a reference and a private access code. Keep both: you need them to <a href="/track">track your complaint</a>.</p></section>
      <section className="card stack"><h2>Lost your access code?</h2><p>The code is shown once and cannot be recovered, because it is stored only in scrambled form. If you gave an email address, check your confirmation email. Otherwise contact the organization and quote your reference. They can confirm identity and help you.</p></section>
      <section className="card stack"><h2>What the statuses mean</h2>
        <dl className="kv" style={{ gridTemplateColumns: "190px 1fr" }}>
          <dt>Submitted</dt><dd>We have received it.</dd><dt>Under Review</dt><dd>We are deciding who should handle it.</dd><dt>Assigned</dt><dd>A person owns your complaint.</dd>
          <dt>Investigation in Progress</dt><dd>We are looking into it.</dd><dt>Awaiting Complainant</dt><dd>We asked you something. The clock is paused until you reply.</dd>
          <dt>Pending Approval</dt><dd>A manager is checking the proposed outcome.</dd><dt>Resolved</dt><dd>We have an outcome. You can reopen it or give feedback.</dd><dt>Closed</dt><dd>Finished.</dd>
        </dl></section>
      <section className="card stack"><h2>Staff</h2><p><a href="/login">Sign in</a> to manage complaints. Administrators can read the setup and operations guides in the project&apos;s <code>docs</code> folder.</p></section>
    </main>
  );
}
