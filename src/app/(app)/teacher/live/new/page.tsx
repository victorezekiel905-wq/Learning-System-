import { requireRole, TEACHERS } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { StartSessionForm } from "./StartSessionForm";

export const metadata = { title: "Start a live class" };

export default async function NewLive({ searchParams }: { searchParams: { class?: string; lesson?: string } }) {
  const { sb } = await requireRole(TEACHERS);
  const [{ data: classes }, { data: lessons }, { data: envs }] = await Promise.all([
    sb.rpc("my_teaching_classes"),
    sb.from("lessons").select("id,title,status").neq("status", "archived").order("updated_at", { ascending: false }).limit(100),
    sb.from("environment_policies").select("id,name").order("name")
  ]);
  return (
    <div className="page max-w-2xl">
      <PageHeader title="Start a live class" subtitle="Students join with the code you'll get on the next screen." />
      <StartSessionForm classes={(classes as { id: string; name: string; students: number }[]) ?? []} lessons={lessons ?? []} envs={envs ?? []}
        defaultClass={searchParams.class} defaultLesson={searchParams.lesson} />
    </div>
  );
}
