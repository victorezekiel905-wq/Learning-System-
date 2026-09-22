import { redirect } from "next/navigation";
import { getMe, homeFor } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Role router: every sign-in lands here and is sent to the right home. */
export default async function DashboardRouter() {
  const me = await getMe();
  if (!me) redirect("/login");
  redirect(me.profile ? homeFor(me.profile.role) : "/onboarding");
}
