import AppShell from "@/components/AppShell";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { me } = await requireRole();
  return <AppShell me={me}>{children}</AppShell>;
}
