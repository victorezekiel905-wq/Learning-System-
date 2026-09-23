import { requireSuperAdmin } from "@/lib/session";
import { Badge, Card, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Platform audit" };

type Row = { id: number; action: string; tenant: string | null; target_type: string | null; target_id: string | null; meta: Record<string, unknown>; created_at: string };

export default async function SuperAudit() {
  const { sb } = await requireSuperAdmin();
  const { data } = await sb.rpc("sa_audit", { p_limit: 500 });
  const rows = (data as Row[]) ?? [];
  return (
    <div className="space-y-4">
      <PageHeader title="Platform audit" subtitle="Everything done from this console. Schools see these actions as 'platform.*' in their own log, without your identity." />
      <Card pad={false}>
        {rows.length === 0 ? <p className="p-5 text-sm text-ink-500">No platform actions yet.</p> : (
          <table className="table"><thead><tr><th>When</th><th>Action</th><th>School</th><th>Details</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}><td className="whitespace-nowrap text-xs">{formatDateTime(r.created_at)}</td><td><Badge tone={/deleted|suspended/.test(r.action) ? "red" : "gray"}>{r.action}</Badge></td>
                <td className="text-sm">{r.tenant ?? "—"}</td><td className="max-w-md truncate font-mono text-[11px] text-ink-500">{JSON.stringify(r.meta)}</td></tr>
            ))}</tbody></table>
        )}
      </Card>
    </div>
  );
}
