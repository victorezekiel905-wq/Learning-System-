import { notFound } from "next/navigation";
import { requireRole, TEACHERS } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { ProgressDashboard } from "@/components/progress/ProgressDashboard";

export const metadata = { title: "Student report" };

/** The same progress view the student and their parents see, for teachers (e.g. before a parent meeting). */
export default async function StudentReportPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const { me, sb } = await requireRole(TEACHERS);
  const { data: student } = await sb.from("users").select("id,full_name").eq("id", id).eq("role", "student").maybeSingle();
  if (!student) notFound();
  return (
    <div className="page">
      <PageHeader eyebrow="Student report" title={student.full_name}
        subtitle="Exactly what the student and their parents see: lessons attended, and results by subject and topic." />
      <ProgressDashboard studentId={student.id} viewer="staff" isAdmin={["school_admin", "platform_admin"].includes(me.profile.role)} />
    </div>
  );
}
