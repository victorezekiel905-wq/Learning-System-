import { requireRole } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { AccountClient } from "./AccountClient";

export const metadata = { title: "Settings" };

export default async function AccountPage({ searchParams }: { searchParams: { reset?: string } }) {
  const { me } = await requireRole();
  return (
    <div className="page max-w-3xl">
      <PageHeader title="Your settings" subtitle={me.tenant?.name} />
      <AccountClient profile={me.profile} resetMode={searchParams.reset === "1"} />
    </div>
  );
}
