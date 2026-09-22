import { redirect } from "next/navigation";
import { getMe, homeFor } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { OnboardingClient } from "./OnboardingClient";

export const metadata = { title: "Finish setting up" };
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const me = await getMe();
  if (!me) redirect("/login?next=/onboarding");
  if (me.profile) redirect(homeFor(me.profile.role));
  const { data: { user } } = await createClient().auth.getUser();
  const meta = (user?.user_metadata ?? {}) as { full_name?: string; intent?: string; school_name?: string; code?: string };
  return (
    <main className="mx-auto max-w-lg px-6 py-10">
      <h1 className="text-2xl font-bold">Finish setting up</h1>
      <p className="mb-6 mt-1 text-sm text-ink-500">Signed in as {me.email}. Create a school, or join one with a code.</p>
      <OnboardingClient defaults={meta} />
    </main>
  );
}
