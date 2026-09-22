import { requireRole, TEACHERS } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { NewGameForm } from "./NewGameForm";

export const metadata = { title: "New Challenge" };

export default async function NewGame({ searchParams }: { searchParams: { class?: string; activity?: string; session?: string } }) {
  const { sb } = await requireRole(TEACHERS);
  const [{ data: classes }, { data: activities }] = await Promise.all([
    sb.rpc("my_teaching_classes"),
    sb.from("activities").select("id,title,kind,lessons(title),questions(count)").in("kind", ["quiz", "multiple_choice"]).order("updated_at", { ascending: false }).limit(200)
  ]);
  return (
    <div className="page max-w-3xl">
      <PageHeader eyebrow="SwiftCipher Challenge" title="New Challenge" subtitle="Only multiple-choice and true/false questions are played; other types are skipped." />
      <NewGameForm classes={(classes as { id: string; name: string }[]) ?? []} activities={(activities ?? []) as never}
        defaults={{ classId: searchParams.class, activityId: searchParams.activity, sessionId: searchParams.session }} />
    </div>
  );
}
