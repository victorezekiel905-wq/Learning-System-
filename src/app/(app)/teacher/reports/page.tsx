import Link from "next/link";
import { requireRole, STAFF } from "@/lib/session";
import { Badge, Card, Empty, PageHeader, Stat } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { GenerateReport } from "./GenerateReport";

export const metadata = { title: "Reports" };

type SessionReport = {
  session: { title: string; minutes: number; started_at: string };
  class: { name: string }; enrolled: number; joined: number; commands: number; hands: number;
  alerts: Record<string, number>;
  activities: { activity_id: string; title: string; attempts: number; avg_percent: number | null }[];
  students: { student_id: string; name: string; joined: boolean; answers: number; correct: number; alerts: number }[];
};

export default async function ReportsPage(props: { searchParams: Promise<{ session?: string; id?: string }> }) {
  const searchParams = await props.searchParams;
  const { sb } = await requireRole(STAFF);
  const { data: reports } = await sb.from("reports").select("id,kind,title,created_at,scope_id").order("created_at", { ascending: false }).limit(100);
  const list = reports ?? [];
  const selected = searchParams.id ? list.find((r) => r.id === searchParams.id) : searchParams.session ? list.find((r) => r.scope_id === searchParams.session) : undefined;
  const { data: full } = selected ? await sb.from("reports").select("payload").eq("id", selected.id).single() : { data: null };
  const { data: classes } = await sb.rpc("my_teaching_classes");

  return (
    <div className="page">
      <PageHeader title="Reports" subtitle="Session summaries are generated automatically when a session ends. Export any report as CSV."
        actions={<GenerateReport classes={(classes as { id: string; name: string }[]) ?? []} />} />
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <Card title="All reports" pad={false}>
          {list.length === 0 ? <p className="p-5 text-sm text-ink-500">No reports yet.</p> : (
            <ul className="max-h-[70vh] divide-y divide-ink-100 overflow-y-auto">{list.map((r) => (
              <li key={r.id}><Link href={`/teacher/reports?id=${r.id}`} className={`block px-4 py-2 no-underline ${selected?.id === r.id ? "bg-brand-50" : "hover:bg-ink-50"}`}>
                <p className="text-sm font-medium text-ink-800">{r.title}</p><p className="text-xs text-ink-500"><Badge>{r.kind.replace("_", " ")}</Badge> {formatDateTime(r.created_at)}</p>
              </Link></li>
            ))}</ul>
          )}
        </Card>
        {!selected ? <Empty title="Pick a report" /> : selected.kind === "session_summary" && full ? <SessionView id={selected.id} r={full.payload as SessionReport} /> : (
          <Card title={selected.title} actions={<a className="btn btn-secondary btn-sm no-underline" href={`/api/reports/${selected.id}/export`}>Export CSV</a>}>
            <pre className="max-h-[60vh] overflow-auto rounded bg-ink-50 p-3 text-xs">{JSON.stringify(full?.payload, null, 2)}</pre>
          </Card>
        )}
      </div>
    </div>
  );
}

function SessionView({ id, r }: { id: string; r: SessionReport }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between"><h2 className="text-lg font-bold">{r.session.title} · {r.class.name}</h2>
        <a className="btn btn-secondary btn-sm no-underline" href={`/api/reports/${id}/export`}>Export CSV</a></div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Attendance" value={`${r.joined}/${r.enrolled}`} /><Stat label="Duration" value={`${r.session.minutes} min`} />
        <Stat label="Teacher commands" value={r.commands} /><Stat label="Help requests" value={r.hands} />
      </div>
      <Card title="Activities">{r.activities.length ? <ul className="text-sm">{r.activities.map((a) => <li key={a.activity_id}>{a.title}: {a.attempts} attempts{a.avg_percent !== null && `, average ${a.avg_percent}%`}</li>)}</ul> : <p className="text-sm text-ink-500">No activities run.</p>}</Card>
      <Card title="Alerts">{Object.keys(r.alerts).length ? <p className="text-sm">{Object.entries(r.alerts).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join(" · ")}</p> : <p className="text-sm text-ink-500">None.</p>}</Card>
      <Card title="Students" pad={false}>
        <table className="table"><thead><tr><th>Student</th><th>Joined</th><th>Answers</th><th>Correct</th><th>Alerts</th></tr></thead>
          <tbody>{r.students.map((s) => <tr key={s.student_id}><td>{s.name}</td><td>{s.joined ? "✓" : "—"}</td><td>{s.answers}</td><td>{s.correct}</td><td>{s.alerts}</td></tr>)}</tbody></table>
      </Card>
    </div>
  );
}
