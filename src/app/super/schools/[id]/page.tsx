import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/session";
import { Badge, Card, PageHeader, Stat } from "@/components/ui";
import { formatDate } from "@/lib/utils";
import { UsersTable, type SaUser } from "../../users/UsersTable";
import { InviteAdmin } from "./InviteAdmin";

type Detail = {
  tenant: { id: string; name: string; slug: string; plan_code: string; status: string; country: string | null; created_at: string; suspended_reason: string | null };
  settings: { brand_name: string | null; parent_portal_enabled: boolean; allow_screen_capture: boolean; telemetry_retention_days: number; learning_retention_days: number };
  subscription: { plan_code: string; status: string; provider: string } | null;
  usage: { classes: number; lessons: number; devices: number; sessions_30d: number };
  users: Omit<SaUser, "tenant" | "tenant_id" | "tenant_status">[];
  invites: { code: string; role: string; email: string | null; uses: number; max_uses: number; expires_at: string; revoked_at: string | null }[];
};

export default async function SchoolDetail(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { sb } = await requireSuperAdmin();
  const { data, error } = await sb.rpc("sa_tenant_detail", { p_tenant: params.id });
  if (error || !data) notFound();
  const d = data as Detail;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={<Link href="/super/schools">Schools</Link>} title={d.tenant.name}
        subtitle={<>{d.tenant.slug} · {d.tenant.plan_code} · created {formatDate(d.tenant.created_at)}</>}
        actions={<><Badge tone={d.tenant.status === "active" ? "green" : "red"}>{d.tenant.status}</Badge><InviteAdmin tenantId={d.tenant.id} /></>} />
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Classes" value={d.usage.classes} /><Stat label="Lessons" value={d.usage.lessons} />
        <Stat label="Devices" value={d.usage.devices} /><Stat label="Sessions (30d)" value={d.usage.sessions_30d} />
      </div>
      <Card title={`People (${d.users.length})`} pad={false}>
        <UsersTable users={d.users.map((u) => ({ ...u, tenant: d.tenant.name, tenant_id: d.tenant.id, tenant_status: d.tenant.status }))} hideTenant />
      </Card>
      {d.invites.length > 0 && (
        <Card title="Staff invites" pad={false}>
          <table className="table"><tbody>{d.invites.map((i) => (
            <tr key={i.code}><td className="font-mono">{i.code}</td><td>{i.role}</td><td className="text-xs">{i.email ?? "any"}</td><td>{i.uses}/{i.max_uses}</td><td className="text-xs">{i.revoked_at ? "revoked" : `expires ${formatDate(i.expires_at)}`}</td></tr>
          ))}</tbody></table>
        </Card>
      )}
    </div>
  );
}
