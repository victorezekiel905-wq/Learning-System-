import { requireRole } from "@/lib/session";
import { StudentLive } from "./StudentLive";

export const metadata = { title: "Live lesson" };

export default async function StudentLivePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { me } = await requireRole(["student"]);
  return <StudentLive sessionId={params.id} me={{ id: me.profile.id, tenantId: me.profile.tenant_id, name: me.profile.full_name }}
    notice={me.settings?.monitoring_notice ?? ""} consented={Boolean(me.monitoring_consent)} />;
}
