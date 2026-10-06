import { redirect } from "next/navigation";
import { getMe } from "@/lib/session";
import { StudentLive } from "@/app/(app)/student/live/[id]/StudentLive";
import { GuestBar } from "./GuestBar";

export const metadata = { title: "Live lesson" };
export const dynamic = "force-dynamic";

/** A guest's live lesson: no school menus, just the lesson. */
export default async function GuestLivePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const me = await getMe();
  if (!me?.profile) redirect("/join");
  if (me.profile.role !== "guest") redirect(`/student/live/${id}`);
  return (
    <div className="min-h-screen bg-ink-50">
      <GuestBar name={me.profile.full_name} school={me.tenant?.name ?? null} />
      <StudentLive guest sessionId={id} me={{ id: me.profile.id, tenantId: me.profile.tenant_id, name: me.profile.full_name }}
        notice={me.settings?.monitoring_notice ?? ""} consented={false} />
    </div>
  );
}
