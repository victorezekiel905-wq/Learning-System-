import { notFound, redirect } from "next/navigation";
import { requireRole, TEACHERS } from "@/lib/session";
import { LiveRoom } from "./LiveRoom";

export const metadata = { title: "Live classroom" };

export default async function LivePage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const params = await props.params;
  const { tab } = await props.searchParams;
  const { me, sb } = await requireRole(TEACHERS);
  const { data: session } = await sb.from("class_sessions").select("id,status,class_id,lesson_id,tenant_id").eq("id", params.id).maybeSingle();
  if (!session) notFound();
  if (session.status !== "live") redirect(`/teacher/reports?session=${params.id}`);
  const [{ data: envs }, { data: scenes }] = await Promise.all([
    sb.from("environment_policies").select("id,name").order("name"),
    sb.from("scenes").select("id,name").order("name")
  ]);
  return <LiveRoom sessionId={params.id} me={{ id: me.profile.id, tenantId: me.profile.tenant_id, name: me.profile.full_name }}
    envs={envs ?? []} scenes={scenes ?? []} initialTab={tab === "screens" ? "screens" : "lesson"} />;
}
