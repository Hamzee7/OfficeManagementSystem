import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { currentAuth } from "@/server/web";
import { Shell } from "@/components/Shell";
import { ThemeStyle } from "@/components/Theme";
import { MfaPanel } from "@/components/MfaClient";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const auth = await currentAuth();
  if (!auth) redirect("/login");
  if (auth.mfaSetupRequired) {
    // The organization requires two-step sign-in: nothing else is available until it is set up.
    return (
      <main className="login-wrap"><ThemeStyle orgId={auth.orgId} />
        <div className="card login-card stack-lg"><div className="stack"><h1>Set up two-step sign-in</h1><p className="muted">Your organization requires it for everyone who works with complaints. It takes a minute and you only do it once.</p></div><MfaPanel enabled={false} /></div>
      </main>
    );
  }
  return <Shell auth={auth}>{children}</Shell>;
}
