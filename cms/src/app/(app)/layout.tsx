import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { currentAuth } from "@/server/web";
import { Shell } from "@/components/Shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const auth = await currentAuth();
  if (!auth) redirect("/login");
  return <Shell auth={auth}>{children}</Shell>;
}
