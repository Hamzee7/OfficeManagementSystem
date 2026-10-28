import { TrackClient } from "@/components/PortalClient";

export const metadata = { title: "Track a complaint" };

export default function Track() {
  return (
    <div className="portal">
      <header className="portal-head"><a href="/" className="brand"><span className="brand-mark" aria-hidden="true">C</span><span>Complaints</span></a><nav className="row"><a href="/submit">Submit a complaint</a><a href="/login">Staff sign in</a></nav></header>
      <main className="portal-main"><div className="hero"><h1>Track your complaint</h1><p>See the latest status, reply to questions, add files, or tell us how we did.</p></div><TrackClient /></main>
    </div>
  );
}
