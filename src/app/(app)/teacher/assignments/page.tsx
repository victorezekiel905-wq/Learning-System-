import Link from "next/link";
import { requireRole, TEACHERS } from "@/lib/session";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { NewAssignment } from "./NewAssignment";

export const metadata = { title: "Assignments" };

export default async function AssignmentsPage() {
  const { sb } = await requireRole(TEACHERS);
  const [{ data: rows }, { data: classes }, { data: activities }, { data: rubrics }] = await Promise.all([
    sb.from("assignments").select("id,title,due_at,status,points_possible,classes(name),submissions(count)").order("created_at", { ascending: false }).limit(200),
    sb.rpc("my_teaching_classes"),
    sb.from("activities").select("id,title,kind").order("updated_at", { ascending: false }).limit(200),
    sb.from("rubrics").select("id,title").order("title")
  ]);
  const list = (rows ?? []) as unknown as { id: string; title: string; due_at: string | null; status: string; points_possible: number; classes: { name: string } | null; submissions: { count: number }[] }[];
  return (
    <div className="page">
      <PageHeader title="Assignments" subtitle="Set work with due dates, resubmission rules and rubrics."
        actions={<><Link href="/teacher/assignments/rubrics" className="btn btn-secondary no-underline">Rubrics</Link>
          <NewAssignment classes={(classes as { id: string; name: string }[]) ?? []} activities={activities ?? []} rubrics={rubrics ?? []} /></>} />
      {list.length === 0 ? <Empty title="No assignments yet">Assign an activity for self-paced work, or ask for a written or file submission graded with a rubric.</Empty> : (
        <div className="card overflow-hidden"><table className="table">
          <thead><tr><th>Assignment</th><th>Class</th><th>Due</th><th>Submissions</th><th>Status</th></tr></thead>
          <tbody>{list.map((a) => (
            <tr key={a.id}><td><Link href={`/teacher/assignments/${a.id}`} className="font-medium">{a.title}</Link></td><td>{a.classes?.name}</td>
              <td className="text-ink-500">{formatDateTime(a.due_at)}</td><td>{a.submissions[0]?.count ?? 0}</td>
              <td><Badge tone={a.status === "published" ? "green" : a.status === "draft" ? "gray" : "amber"}>{a.status}</Badge></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
