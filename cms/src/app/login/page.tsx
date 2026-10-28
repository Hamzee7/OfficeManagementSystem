import { redirect } from "next/navigation";
import { currentAuth } from "@/server/web";
import { LoginForm } from "@/components/AuthClient";
import { ThemeStyle, BrandMark } from "@/components/Theme";
import { getDb } from "@/server/db";
import { loadOrg } from "@/server/org";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function Login() {
  if (await currentAuth()) redirect("/");
  const first = getDb().prepare("SELECT id FROM organizations ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
  const org = first ? loadOrg(getDb(), first.id) : null;
  return (
    <main className="login-wrap">
      <ThemeStyle />
      <div className="card login-card stack-lg">
        <div className="stack"><BrandMark name={org?.name ?? "C"} hasLogo={!!org?.hasLogo} /><h1>Staff sign in</h1><p className="muted">Sign in to manage complaints. If you want to report a problem, you do not need an account.</p></div>
        <LoginForm />
        <div className="row-between"><a href="/submit">Submit a complaint</a><a href="/track">Track a complaint</a></div>
      </div>
    </main>
  );
}
