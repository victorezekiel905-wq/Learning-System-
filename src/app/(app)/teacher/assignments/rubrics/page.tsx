import { requireRole, TEACHERS } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { RubricsClient } from "./RubricsClient";

export const metadata = { title: "Rubrics" };

export default async function RubricsPage() {
  const { me, sb } = await requireRole(TEACHERS);
  const { data } = await sb.from("rubrics").select("id,title,criteria,owner_id").order("title");
  return (
    <div className="page max-w-4xl">
      <PageHeader title="Rubrics" subtitle="Reusable marking criteria for short answers and assignments." />
      <RubricsClient rubrics={(data ?? []) as never} me={{ id: me.profile.id, tenantId: me.profile.tenant_id }} />
    </div>
  );
}
