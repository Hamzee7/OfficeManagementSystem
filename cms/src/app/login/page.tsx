import { redirect } from "next/navigation";
import { currentAuth } from "@/server/web";
import { LoginForm } from "@/components/AuthClient";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function Login() {
  if (await currentAuth()) redirect("/");
  return (
    <main className="login-wrap">
      <div className="card login-card stack-lg">
        <div className="stack"><div className="brand-mark" aria-hidden="true">C</div><h1>Staff sign in</h1><p className="muted">Sign in to manage complaints. If you want to report a problem, you do not need an account.</p></div>
        <LoginForm />
        <div className="row-between"><a href="/submit">Submit a complaint</a><a href="/track">Track a complaint</a></div>
      </div>
    </main>
  );
}
