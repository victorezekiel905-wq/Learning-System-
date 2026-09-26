import { notFound } from "next/navigation";
import { requireRole, TEACHERS } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { ChildReport } from "@/components/parent/ChildReport";

export const metadata = { title: "Student report" };

/** The same daily/weekly report the student's parents see, for teachers (e.g. before a parent meeting). */
export default async function StudentReportPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const { me, sb } = await requireRole(TEACHERS);
  const { data: student } = await sb.from("users").select("id,full_name").eq("id", id).eq("role", "student").maybeSingle();
  if (!student) notFound();
  return (
    <div className="page">
      <PageHeader eyebrow="Student report" title={student.full_name}
        subtitle="Exactly what this student's parents see: participation, progress by subject and focus, day by day and week by week." />
      <ChildReport studentId={student.id} viewer="staff" meId={me.profile.id} />
    </div>
  );
}
