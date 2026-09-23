import Link from "next/link";
import { requireSuperAdmin } from "@/lib/session";
import { Card, PageHeader, Stat } from "@/components/ui";

type Overview = {
  tenants: number; tenants_suspended: number; users: number; users_suspended: number; by_role: Record<string, number>;
  devices: number; devices_online: number; live_sessions: number; sessions_30d: number; by_plan: Record<string, number>;
};

export default async function SuperOverview() {
  const { sb } = await requireSuperAdmin();
  const { data } = await sb.rpc("sa_overview");
  const o = data as Overview;
  return (
    <div className="space-y-6">
      <PageHeader title="Platform overview" subtitle="Every school on SwiftCipher. Only you can see this console."
        actions={<Link href="/super/schools?new=1" className="btn btn-primary no-underline">Create school</Link>} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Schools" value={o.tenants} sub={`${o.tenants_suspended} suspended`} tone={o.tenants_suspended ? "red" : undefined} />
        <Stat label="Users" value={o.users} sub={`${o.users_suspended} suspended`} />
        <Stat label="Devices online" value={`${o.devices_online}/${o.devices}`} />
        <Stat label="Live sessions now" value={o.live_sessions} sub={`${o.sessions_30d} in the last 30 days`} tone="green" />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Users by role"><ul className="space-y-1 text-sm">{Object.entries(o.by_role).map(([k, v]) => <li key={k} className="flex justify-between"><span className="capitalize">{k.replace("_", " ")}</span><span className="tabular-nums">{v}</span></li>)}</ul></Card>
        <Card title="Schools by plan"><ul className="space-y-1 text-sm">{Object.entries(o.by_plan).map(([k, v]) => <li key={k} className="flex justify-between"><span>{k.replace("_", " ")}</span><span className="tabular-nums">{v}</span></li>)}</ul></Card>
      </div>
    </div>
  );
}
