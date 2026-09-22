import { requireRole, ADMINS } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { SettingsClient } from "./SettingsClient";

export const metadata = { title: "Settings & privacy" };

export default async function SettingsPage() {
  const { me, sb } = await requireRole(ADMINS);
  const [{ data: tenant }, { data: settings }, { data: schools }, { data: flags }] = await Promise.all([
    sb.from("tenants").select("id,name,country,timezone,slug").single(),
    sb.from("tenant_settings").select("*").single(),
    sb.from("schools").select("id,name").order("name"),
    sb.from("feature_flags").select("id,key,enabled,tenant_id").order("key")
  ]);
  return (
    <div className="page max-w-5xl">
      <PageHeader title="Settings & privacy" subtitle="Every change here is recorded in the audit log." />
      <SettingsClient tenant={tenant!} settings={settings!} schools={schools ?? []} flags={flags ?? []} plan={me.plan!} />
    </div>
  );
}
