import { requireRole } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { MessagesClient } from "./MessagesClient";

export const metadata = { title: "Messages" };

export default async function MessagesPage({ searchParams }: { searchParams: { thread?: string; class?: string } }) {
  const { me, sb } = await requireRole(["student", "teacher", "school_admin", "platform_admin"]);
  const [{ data: threads }, classes] = await Promise.all([
    sb.from("chat_threads").select("id,kind,class_id,student_id,teacher_id,created_at,classes(name),student:users!chat_threads_student_id_tenant_id_fkey(full_name),teacher:users!chat_threads_teacher_id_tenant_id_fkey(full_name)")
      .eq("kind", "direct").order("created_at", { ascending: false }),
    me.profile.role === "student" ? sb.rpc("student_home").then((r) => ((r.data as { classes: { id: string; name: string; teacher: string }[] })?.classes ?? [])) : sb.rpc("my_teaching_classes").then((r) => (r.data as { id: string; name: string }[]) ?? [])
  ]);
  return (
    <div className="page">
      <PageHeader title="Messages" subtitle="Private conversations between teachers and students." />
      <MessagesClient threads={(threads ?? []) as never} classes={classes as never} me={{ id: me.profile.id, role: me.profile.role }}
        initialThread={searchParams.thread} initialClass={searchParams.class} />
    </div>
  );
}
