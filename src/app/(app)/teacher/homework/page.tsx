import { requireRole, TEACHERS } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { HomeworkBoard, type HomeworkRow } from "./HomeworkBoard";

export const metadata = { title: "Homework" };

/** Homework (migration 1080): set a lesson for a class with a due date, and see who has done it. */
export default async function HomeworkPage(props: { searchParams: Promise<{ lesson?: string }> }) {
  const { lesson } = await props.searchParams;
  const { me, sb } = await requireRole(TEACHERS);
  const [hw, classes, lessons] = await Promise.all([
    sb.rpc("teacher_homework"),
    sb.rpc("my_teaching_classes"),
    sb.from("lessons").select("id,title,owner_id").neq("status", "archived").or(`owner_id.eq.${me.profile.id},status.eq.published`)
      .order("updated_at", { ascending: false }).limit(200)
  ]);
  return (
    <div className="page">
      <PageHeader title="Homework" subtitle="Set a lesson for a class to work through at home. Answers are marked as in class and count in progress reports." />
      <HomeworkBoard rows={(hw.data as HomeworkRow[] | null) ?? []} classes={(classes.data as { id: string; name: string }[] | null) ?? []}
        lessons={(lessons.data ?? []).map((l) => ({ id: l.id as string, title: l.title as string, mine: l.owner_id === me.profile.id }))} initialLesson={lesson} />
    </div>
  );
}
