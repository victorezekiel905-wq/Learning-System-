import { requireSuperAdmin } from "@/lib/session";
import { Card, PageHeader } from "@/components/ui";
import { UsersTable, type SaUser } from "./UsersTable";

export const metadata = { title: "Users" };

export default async function SuperUsers({ searchParams }: { searchParams: { q?: string } }) {
  const { sb } = await requireSuperAdmin();
  const { data } = await sb.rpc("sa_list_users", { p_search: searchParams.q || null, p_tenant: null });
  return (
    <div className="space-y-4">
      <PageHeader title="All users" subtitle="Search across every school. Change roles, suspend, lift suspensions or delete." />
      <form className="flex gap-2"><input name="q" defaultValue={searchParams.q} placeholder="Name or email" className="input w-72" /><button className="btn btn-secondary">Search</button></form>
      <Card pad={false}><UsersTable users={(data as SaUser[]) ?? []} /></Card>
      <p className="text-xs text-ink-500">Showing up to 500 of the newest matches.</p>
    </div>
  );
}
