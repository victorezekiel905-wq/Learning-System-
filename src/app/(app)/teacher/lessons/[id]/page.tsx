import { notFound } from "next/navigation";
import { requireRole, TEACHERS } from "@/lib/session";
import { LessonEditor } from "./LessonEditor";

export const metadata = { title: "Lesson editor" };

export default async function LessonPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { me, sb } = await requireRole(TEACHERS);
  const { data: lesson } = await sb.from("lessons").select("*").eq("id", params.id).maybeSingle();
  if (!lesson) notFound();
  const [{ data: rubrics }, { data: classes }] = await Promise.all([
    sb.from("rubrics").select("id,title").order("title"),
    sb.rpc("my_teaching_classes")
  ]);
  const canEdit = lesson.owner_id === me.profile.id || ["school_admin", "platform_admin"].includes(me.profile.role);
  return <LessonEditor lesson={lesson} canEdit={canEdit} userId={me.profile.id} rubrics={rubrics ?? []} classes={(classes as { id: string; name: string }[]) ?? []} />;
}
