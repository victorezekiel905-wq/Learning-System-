import { requireRole } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { ProgressDashboard } from "@/components/progress/ProgressDashboard";

export const metadata = { title: "My progress" };

export default async function StudentProgress() {
  const { me } = await requireRole(["student"]);
  return (
    <div className="page">
      <PageHeader title="My progress" subtitle="How you're doing in each subject: what you're strong in, and what to practise next." />
      <ProgressDashboard studentId={me.profile.id} viewer="student" />
    </div>
  );
}
