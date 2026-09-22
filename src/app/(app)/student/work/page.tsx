import Link from "next/link";
import { requireRole } from "@/lib/session";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "My work" };

export default async function StudentWork() {
  const { sb } = await requireRole(["student"]);
  const { data } = await sb.rpc("student_home");
  const assignments = ((data as { assignments: { id: string; title: string; due_at: string | null; class: string; submitted: boolean; late_allowed: boolean }[] })?.assignments) ?? [];
  return (
    <div className="page">
      <PageHeader title="My work" subtitle="Assignments from all your classes." />
      {assignments.length === 0 ? <Empty title="No assignments yet" /> : (
        <div className="card overflow-hidden">
          <table className="table">
            <thead><tr><th>Assignment</th><th>Class</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>{assignments.map((a) => {
              const overdue = a.due_at && new Date(a.due_at) < new Date();
              return (
                <tr key={a.id}>
                  <td><Link href={`/student/assignments/${a.id}`} className="font-medium">{a.title}</Link></td>
                  <td>{a.class}</td><td className="text-ink-500">{formatDateTime(a.due_at)}</td>
                  <td>{a.submitted ? <Badge tone="green">Submitted</Badge> : overdue ? <Badge tone={a.late_allowed ? "amber" : "red"}>{a.late_allowed ? "Late" : "Closed"}</Badge> : <Badge tone="brand">To do</Badge>}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
