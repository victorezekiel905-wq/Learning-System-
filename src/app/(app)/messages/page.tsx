import { requireRole } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { MessagesClient } from "./MessagesClient";

export const metadata = { title: "Messages" };

export default async function MessagesPage(props: { searchParams: Promise<{ thread?: string; class?: string }> }) {
  const searchParams = await props.searchParams;
  const { me, sb } = await requireRole(["student", "teacher", "school_admin", "platform_admin", "parent"]);
  const base = "id,kind,class_id,student_id,teacher_id,created_at,classes(name),student:users!chat_threads_student_id_tenant_id_fkey(full_name),teacher:users!chat_threads_teacher_id_tenant_id_fkey(full_name)";
  const role = me.profile.role;
  const [withParents, classes] = await Promise.all([
    sb.from("chat_threads").select(`${base},parent_id,parent:users!chat_threads_parent_fkey(full_name)`)
      .in("kind", ["direct", "parent"]).order("created_at", { ascending: false }).limit(300),
    role === "student" ? sb.rpc("student_home").then((r) => ((r.data as { classes: { id: string; name: string; teacher: string }[] })?.classes ?? []))
      : role === "parent" ? Promise.resolve([])
      : sb.rpc("my_teaching_classes").then((r) => (r.data as { id: string; name: string }[]) ?? [])
  ]);
  // Before the 0820 database update there are no parent threads: fall back to the original list.
  const threads = withParents.error
    ? (await sb.from("chat_threads").select(base).eq("kind", "direct").order("created_at", { ascending: false }).limit(300)).data
    : withParents.data;
  return (
    <div className="page">
      <PageHeader title="Messages" subtitle={role === "parent" ? "Private conversations with your child's teachers." : "Private conversations with students and parents."} />
      <MessagesClient threads={(threads ?? []) as never} classes={classes as never} me={{ id: me.profile.id, role: me.profile.role }}
        initialThread={searchParams.thread} initialClass={searchParams.class} />
    </div>
  );
}
