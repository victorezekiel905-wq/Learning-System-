import { requireRole, ADMINS } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { SchoolProgress } from "./SchoolProgress";

export const metadata = { title: "School progress" };

export default async function SchoolProgressPage() {
  await requireRole(ADMINS);
  return (
    <div className="page">
      <PageHeader title="School progress" subtitle="Where pupils are struggling, by subject and topic, and who needs help. For the whole school or one class." />
      <SchoolProgress />
    </div>
  );
}
