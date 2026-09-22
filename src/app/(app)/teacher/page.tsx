import Link from "next/link";
import { requireRole, TEACHERS } from "@/lib/session";
import { Badge, Card, Empty, PageHeader, Stat } from "@/components/ui";
import { formatDateTime, timeAgo } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

export default async function TeacherHome() {
  const { me, sb } = await requireRole(TEACHERS);
  const uid = me.profile.id;

  const [classes, live, lessons, pending, alerts, assignments] = await Promise.all([
    sb.from("classes").select("id,name,subject,join_code").is("archived_at", null).order("created_at"),
    sb.from("class_sessions").select("id,title,join_code,started_at,class_id").eq("status", "live").eq("teacher_id", uid),
    sb.from("lessons").select("id,title,status,updated_at").eq("owner_id", uid).order("updated_at", { ascending: false }).limit(5),
    sb.from("quiz_answers").select("id", { count: "exact", head: true }).eq("status", "pending_review"),
    sb.from("environment_events").select("id,kind,rule,created_at,class_session_id,student_id").eq("status", "open").order("created_at", { ascending: false }).limit(5),
    sb.from("assignments").select("id,title,due_at,class_id").gte("due_at", new Date().toISOString()).order("due_at").limit(5)
  ]);

  const myClasses = (classes.data ?? []) as { id: string; name: string; subject: string | null; join_code: string }[];
  const firstName = me.profile.full_name.split(" ")[0];

  return (
    <div className="page">
      <PageHeader eyebrow="Teacher workspace" title={`Hello, ${firstName}`} subtitle="Pick up where you left off."
        actions={<>
          <Link href="/teacher/lessons?new=1" className="btn btn-secondary no-underline">New lesson</Link>
          <Link href="/teacher/challenge/new" className="btn btn-secondary no-underline">New Challenge</Link>
          <Link href="/teacher/live/new" className="btn btn-primary no-underline">Start live class</Link>
        </>} />

      {(live.data ?? []).length > 0 && (
        <div className="mb-6 space-y-2">
          {(live.data ?? []).map((s) => (
            <Link key={s.id} href={`/teacher/live/${s.id}`} className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 no-underline">
              <span className="font-semibold text-emerald-900">● Live now: {s.title}</span>
              <span className="text-sm text-emerald-800">Code <span className="font-mono font-bold">{s.join_code}</span> · started {timeAgo(s.started_at)} → Open</span>
            </Link>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Classes" value={myClasses.length} />
        <Stat label="Awaiting review" value={pending.count ?? 0} sub={<Link href="/teacher/review">Open review queue</Link>} />
        <Stat label="Open alerts" value={(alerts.data ?? []).length} tone={(alerts.data ?? []).length ? "red" : undefined} />
        <Stat label="Lessons" value={(lessons.data ?? []).length} sub="recently edited" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Your classes" actions={<Link href="/teacher/classes" className="text-sm">Manage</Link>}>
          {myClasses.length === 0 ? (
            <Empty title="No classes yet" action={<Link href="/teacher/classes" className="btn btn-primary no-underline">Create a class</Link>}>
              Create a class, then share its join code with your students.
            </Empty>
          ) : (
            <ul className="divide-y divide-ink-100">
              {myClasses.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-2.5">
                  <Link href={`/teacher/classes/${c.id}`} className="font-medium">{c.name}</Link>
                  <div className="flex items-center gap-3 text-sm text-ink-500">
                    {c.subject && <span>{c.subject}</span>}
                    <span className="font-mono">{c.join_code}</span>
                    <Link href={`/teacher/live/new?class=${c.id}`} className="btn btn-secondary btn-sm no-underline">Go live</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Recent lessons" actions={<Link href="/teacher/lessons" className="text-sm">All</Link>}>
            {(lessons.data ?? []).length === 0 ? <p className="text-sm text-ink-500">No lessons yet.</p> : (
              <ul className="space-y-2 text-sm">
                {(lessons.data ?? []).map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2">
                    <Link href={`/teacher/lessons/${l.id}`} className="truncate">{l.title}</Link>
                    <Badge tone={l.status === "published" ? "green" : "gray"}>{l.status}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Upcoming due dates">
            {(assignments.data ?? []).length === 0 ? <p className="text-sm text-ink-500">Nothing due soon.</p> : (
              <ul className="space-y-2 text-sm">
                {(assignments.data ?? []).map((a) => (
                  <li key={a.id}><Link href={`/teacher/assignments/${a.id}`}>{a.title}</Link><span className="block text-xs text-ink-500">{formatDateTime(a.due_at)}</span></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
