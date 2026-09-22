import { requireRole, STAFF } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { EnvironmentsClient } from "./EnvironmentsClient";
import type { EnvironmentPolicy } from "@/lib/types";

export const metadata = { title: "Environments" };

export default async function EnvironmentsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const { me, sb } = await requireRole(STAFF);
  const [{ data: policies }, { data: scenes }] = await Promise.all([
    sb.from("environment_policies").select("*").order("name"),
    sb.from("scenes").select("id,name,description,policy_id,owner_id,scene_rules(id,rule_type,value,position)").order("name")
  ]);
  return (
    <div className="page">
      <PageHeader eyebrow="SwiftCipher Guard" title="Environments & scenes"
        subtitle="An environment is the set of sites and conditions allowed during a session. The server evaluates every change deterministically." />
      <EnvironmentsClient policies={(policies ?? []) as EnvironmentPolicy[]} scenes={(scenes ?? []) as never}
        me={{ id: me.profile.id, tenantId: me.profile.tenant_id, isIt: ["it_admin", "school_admin", "platform_admin"].includes(me.profile.role) }}
        initialTab={searchParams.tab === "scenes" ? "scenes" : "policies"} />
    </div>
  );
}
