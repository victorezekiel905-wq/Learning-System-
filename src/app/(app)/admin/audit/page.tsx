import { Icon } from "@/components/Icon";
import Link from "next/link";
import { requireRole, ADMINS } from "@/lib/session";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Audit log" };
const PAGE = 100;

export default async function AuditPage(props: { searchParams: Promise<{ action?: string; page?: string }> }) {
  const searchParams = await props.searchParams;
  const { sb } = await requireRole(ADMINS);
  const page = Math.max(Number(searchParams.page ?? 0), 0);
  let q = sb.from("audit_logs").select("id,action,target_type,target_id,meta,created_at,actor_id", { count: "exact" })
    .order("created_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
  if (searchParams.action) q = q.ilike("action", `${searchParams.action.replace(/[%_]/g, "")}%`);
  const { data, count } = await q;
  const actorIds = Array.from(new Set((data ?? []).map((r) => r.actor_id).filter(Boolean)));
  const { data: actors } = actorIds.length ? await sb.from("users").select("id,full_name").in("id", actorIds) : { data: [] };
  const names = Object.fromEntries((actors ?? []).map((a) => [a.id, a.full_name]));

  return (
    <div className="page">
      <PageHeader title="Audit log" subtitle="Screen access, device commands, policy and settings changes, grades, privacy requests." />
      <form className="mb-4 flex flex-wrap gap-2">
        <select name="action" defaultValue={searchParams.action ?? ""} className="input w-64">
          <option value="">All actions</option>
          {["command", "spotlight", "screen", "environment", "alert", "settings", "device", "user", "privacy", "invite", "grade", "session", "billing", "class_members"].map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <button className="btn btn-secondary">Filter</button>
      </form>
      {!(data ?? []).length ? <Empty title="No entries" /> : (
        <div className="card overflow-x-auto"><table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
          <tbody>{(data ?? []).map((r) => (
            <tr key={r.id}><td className="whitespace-nowrap text-xs">{formatDateTime(r.created_at)}</td><td className="text-sm">{names[r.actor_id] ?? (r.actor_id ? "former user" : "system")}</td>
              <td><Badge tone={/command|spotlight|screen/.test(r.action) ? "amber" : /privacy|delete|role/.test(r.action) ? "red" : "gray"}>{r.action}</Badge></td>
              <td className="text-xs text-ink-500">{r.target_type}</td>
              <td className="max-w-md truncate font-mono text-[11px] text-ink-500" title={JSON.stringify(r.meta)}>{JSON.stringify(r.meta)}</td></tr>
          ))}</tbody>
        </table></div>
      )}
      <div className="mt-4 flex justify-between text-sm">
        {page > 0 ? <Link href={`/admin/audit?page=${page - 1}&action=${searchParams.action ?? ""}`} className="btn btn-secondary btn-sm no-underline"><Icon name="chevronLeft" className="h-4 w-4" />Newer</Link> : <span />}
        {(count ?? 0) > (page + 1) * PAGE && <Link href={`/admin/audit?page=${page + 1}&action=${searchParams.action ?? ""}`} className="btn btn-secondary btn-sm no-underline">Older<Icon name="chevronRight" className="h-4 w-4" /></Link>}
      </div>
    </div>
  );
}
