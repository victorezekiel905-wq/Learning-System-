import { requireRole, TEACHERS } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { ReviewQueue } from "./ReviewQueue";

export const metadata = { title: "Review queue" };

export default async function ReviewPage() {
  const { sb } = await requireRole(TEACHERS);
  const [{ data: rubrics }] = await Promise.all([sb.from("rubrics").select("id,title,criteria")]);
  return (
    <div className="page max-w-5xl">
      <PageHeader title="Review queue" subtitle="Open answers, short answers, drawings, files and code that need your judgement." />
      <ReviewQueue rubrics={(rubrics ?? []) as never} />
    </div>
  );
}
