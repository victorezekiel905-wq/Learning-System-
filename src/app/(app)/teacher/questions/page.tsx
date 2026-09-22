import { requireRole, TEACHERS } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { QuestionBank } from "./QuestionBank";

export const metadata = { title: "Question bank" };

export default async function QuestionsPage() {
  const { me } = await requireRole(TEACHERS);
  return (
    <div className="page max-w-5xl">
      <PageHeader title="Question bank" subtitle="Questions shared across your school. Add them to any activity from the activity editor." />
      <QuestionBank me={{ id: me.profile.id, tenantId: me.profile.tenant_id }} />
    </div>
  );
}
