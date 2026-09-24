import { notFound } from "next/navigation";
import { requireRole, STAFF } from "@/lib/session";
import { ClassDetail } from "./ClassDetail";

export const metadata = { title: "Class" };

export default async function ClassPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { me, sb } = await requireRole(STAFF);
  const { data: cls } = await sb.from("classes").select("*").eq("id", params.id).maybeSingle();
  if (!cls) notFound();
  const [{ data: access }, { data: policies }, { data: teachers }] = await Promise.all([
    sb.rpc("class_access", { p_class: params.id }),
    sb.from("environment_policies").select("id,name").order("name"),
    sb.from("users").select("id,full_name").in("role", ["teacher", "school_admin"]).eq("status", "active").order("full_name")
  ]);
  const isAdmin = ["school_admin", "platform_admin"].includes(me.profile.role);
  return (
    <ClassDetail cls={cls} canManage={Boolean((access as { manage?: boolean } | null)?.manage)} isAdmin={isAdmin}
      policies={policies ?? []} teachers={teachers ?? []} />
  );
}
