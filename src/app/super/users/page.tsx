import Link from "next/link";
import { requireSuperAdmin } from "@/lib/session";
import { Card, PageHeader } from "@/components/ui";
import { UsersTable, type SaUser } from "./UsersTable";

export const metadata = { title: "Users" };

type Page = { rows: SaUser[]; next_cursor: string | null };

export default async function SuperUsers(props: { searchParams: Promise<{ q?: string; cursor?: string }> }) {
  const searchParams = await props.searchParams;
  const { sb } = await requireSuperAdmin();
  const { data } = await sb.rpc("sa_list_users", { p_search: searchParams.q || null, p_tenant: null, p_cursor: searchParams.cursor || null, p_limit: 50 });
  const page = (data as Page | null) ?? { rows: [], next_cursor: null };
  const q = searchParams.q ? `q=${encodeURIComponent(searchParams.q)}&` : "";
  return (
    <div className="space-y-4">
      <PageHeader title="All users" subtitle="Search across every school. Change roles, suspend, lift suspensions or delete." />
      <form className="flex flex-wrap gap-2"><input name="q" defaultValue={searchParams.q} placeholder="Name or email" className="input w-full sm:w-72" /><button className="btn btn-secondary">Search</button></form>
      <Card pad={false}><UsersTable users={page.rows} /></Card>
      <nav className="flex items-center justify-between text-sm" aria-label="Pages">
        {searchParams.cursor ? <Link href={`/super/users?${q}`}>← First page</Link> : <span className="text-xs text-ink-500">Newest first, 50 per page.</span>}
        {page.next_cursor && <Link href={`/super/users?${q}cursor=${encodeURIComponent(page.next_cursor)}`} className="btn btn-secondary btn-sm no-underline">Next page →</Link>}
      </nav>
    </div>
  );
}
