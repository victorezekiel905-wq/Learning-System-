import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperAdmin } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { TenantSettingsForm, type SaSettings } from "./TenantSettingsForm";

export const metadata = { title: "School settings" };

export default async function SchoolSettingsPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { sb } = await requireSuperAdmin();
  const { data, error } = await sb.rpc("sa_tenant_detail", { p_tenant: params.id });
  if (error || !data) notFound();
  const d = data as { tenant: { id: string; name: string; timezone: string }; settings: Omit<SaSettings, "timezone"> };
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader eyebrow={<Link href={`/super/schools/${d.tenant.id}`}>{d.tenant.name}</Link>} title="School settings"
        subtitle="The same settings the school's own admins see. Changes are recorded in the platform audit log, and in the school's log as a platform action." />
      <TenantSettingsForm tenantId={d.tenant.id} initial={{ ...d.settings, timezone: d.tenant.timezone }} />
    </div>
  );
}
