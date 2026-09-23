import { requireSuperAdmin } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { SchoolsClient, type TenantRow } from "./SchoolsClient";

export const metadata = { title: "Schools" };

export default async function SchoolsPage({ searchParams }: { searchParams: { q?: string; new?: string } }) {
  const { sb } = await requireSuperAdmin();
  const [{ data }, { data: plans }] = await Promise.all([
    sb.rpc("sa_list_tenants", { p_search: searchParams.q || null }),
    sb.from("plans").select("code,name").order("sort")
  ]);
  return (
    <div>
      <PageHeader title="Schools (tenants)" subtitle="Create, rename, change plan, suspend, restore or delete any school." />
      <SchoolsClient tenants={(data as TenantRow[]) ?? []} plans={plans ?? []} q={searchParams.q ?? ""} openNew={searchParams.new === "1"} />
    </div>
  );
}
