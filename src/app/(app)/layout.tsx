import AppShell from "@/components/AppShell";
import { TermsBanner } from "@/components/TermsBanner";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { me, sb } = await requireRole();
  const { count } = await sb.from("consents").select("id", { count: "exact", head: true })
    .eq("user_id", me.profile.id).eq("kind", "terms_of_service");
  return (
    <>
      {count === 0 && <TermsBanner />}
      <AppShell me={me}>{children}</AppShell>
    </>
  );
}
