import Link from "next/link";
import { requireRole, TEACHERS } from "@/lib/session";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Live classroom" };

export default async function LiveList() {
  const { sb } = await requireRole(TEACHERS);
  const { data } = await sb.from("class_sessions")
    .select("id,title,status,join_code,mode,started_at,ended_at,classes(name)").order("created_at", { ascending: false }).limit(50);
  const sessions = (data ?? []) as unknown as { id: string; title: string; status: string; join_code: string; mode: string; started_at: string | null; ended_at: string | null; classes: { name: string } | null }[];
  return (
    <div className="page">
      <PageHeader eyebrow="SwiftCipher Live" title="Live classroom" subtitle="Run lessons live, see responses and screens, and keep the class focused."
        actions={<Link href="/teacher/live/new" className="btn btn-primary no-underline">Start a live class</Link>} />
      {sessions.length === 0 ? <Empty title="No sessions yet">Start a live class to share a join code with your students.</Empty> : (
        <div className="card overflow-hidden">
          <table className="table">
            <thead><tr><th>Session</th><th>Class</th><th>Mode</th><th>Status</th><th>Started</th><th /></tr></thead>
            <tbody>{sessions.map((s) => (
              <tr key={s.id}>
                <td className="font-medium">{s.title}</td><td>{s.classes?.name}</td><td className="capitalize">{s.mode.replace(/_/g, " ")}</td>
                <td>{s.status === "live" ? <Badge tone="green" dot>Live · {s.join_code}</Badge> : <Badge>Ended</Badge>}</td>
                <td className="text-ink-500">{formatDateTime(s.started_at)}</td>
                <td className="text-right">{s.status === "live" ? <Link href={`/teacher/live/${s.id}`} className="btn btn-primary btn-sm no-underline">Open</Link>
                  : <Link href={`/teacher/reports?session=${s.id}`} className="btn btn-secondary btn-sm no-underline">Report</Link>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
