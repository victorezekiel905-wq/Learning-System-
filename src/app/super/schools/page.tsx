import Link from "next/link";
import { requireSuperAdmin } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { SchoolsClient, type TenantRow } from "./SchoolsClient";

export const metadata = { title: "Schools" };

type Page = { rows: TenantRow[]; next_cursor: string | null };

export default async function SchoolsPage(props: { searchParams: Promise<{ q?: string; new?: string; cursor?: string }> }) {
  const searchParams = await props.searchParams;
  const { sb } = await requireSuperAdmin();
  const [{ data }, { data: plans }] = await Promise.all([
    sb.rpc("sa_list_tenants", { p_search: searchParams.q || null, p_cursor: searchParams.cursor || null, p_limit: 50 }),
    sb.from("plans").select("code,name").order("sort")
  ]);
  const page = (data as Page | null) ?? { rows: [], next_cursor: null };
  const q = searchParams.q ? `q=${encodeURIComponent(searchParams.q)}&` : "";
  return (
    <div>
      <PageHeader title="Schools (tenants)" subtitle="Create, rename, change plan, suspend, restore or delete any school. Newest first, 50 per page." />
      <SchoolsClient tenants={page.rows} plans={plans ?? []} q={searchParams.q ?? ""} openNew={searchParams.new === "1"} />
      <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pages">
        {searchParams.cursor ? <Link href={`/super/schools?${q}`}>← First page</Link> : <span />}
        {page.next_cursor && <Link href={`/super/schools?${q}cursor=${encodeURIComponent(page.next_cursor)}`} className="btn btn-secondary btn-sm no-underline">Next page →</Link>}
      </nav>
    </div>
  );
}
