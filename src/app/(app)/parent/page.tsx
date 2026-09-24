import Link from "next/link";
import { requireRole } from "@/lib/session";
import { Alert, Badge, Card, Empty, PageHeader, Stat } from "@/components/ui";
import { formatDate, pct } from "@/lib/utils";
import { ParentConsent, type ConsentRow } from "./ParentConsent";

export const metadata = { title: "My children" };

type Summary = {
  student: { id: string; name: string };
  classes: { id: string; name: string; subject: string | null }[];
  attendance: { present: number; late: number; absent: number; excused: number; recent: { date: string; status: string; class: string }[] };
  learning: { accuracy_30d: number | null; activities_completed_30d: number; sessions_joined_30d: number; released_grades: { assignment: string; score: number; out_of: number; feedback: string | null; released_at: string }[] };
  screen_time: { managed_minutes_30d: number; focus_alerts_30d: number };
};

export default async function ParentPage(props: { searchParams: Promise<{ child?: string }> }) {
  const searchParams = await props.searchParams;
  const { me, sb } = await requireRole(["parent"]);
  if (!me.settings?.parent_portal_enabled) {
    return <div className="page max-w-xl"><Alert title="The parent portal is not switched on">Your school hasn't enabled parent summaries yet. Please contact the school office.</Alert></div>;
  }
  const { data: kids } = await sb.rpc("parent_children");
  const children = (kids as { id: string; name: string }[]) ?? [];
  const childId = searchParams.child ?? children[0]?.id;
  const [{ data }, { data: consent }] = childId
    ? await Promise.all([
        sb.rpc("student_summary", { p_student: childId }),
        sb.from("monitoring_consents").select("method,reference,recorded_at,revoked_at").eq("student_id", childId).maybeSingle()
      ])
    : [{ data: null }, { data: null }];
  const s = data as Summary | null;

  return (
    <div className="page">
      <PageHeader title="My children" subtitle="Attendance, learning progress and screen-time summaries your school shares with you." />
      {children.length === 0 ? <Empty title="No linked children">Ask your school for a parent invite code.</Empty> : (
        <>
          {children.length > 1 && <nav className="mb-4 flex gap-2">{children.map((c) => <Link key={c.id} href={`/parent?child=${c.id}`} className={`btn btn-sm no-underline ${c.id === childId ? "btn-primary" : "btn-secondary"}`}>{c.name}</Link>)}</nav>}
          {s && (
            <div className="space-y-6">
              <h2 className="text-xl font-bold">{s.student.name}</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Present (90 days)" value={s.attendance.present} sub={`${s.attendance.late} late · ${s.attendance.absent} absent`} />
                <Stat label="Answer accuracy (30 days)" value={pct(s.learning.accuracy_30d)} />
                <Stat label="Activities completed" value={s.learning.activities_completed_30d} sub="last 30 days" />
                <Stat label="Managed class time" value={`${s.screen_time.managed_minutes_30d} min`} sub={`${s.screen_time.focus_alerts_30d} focus reminders`} />
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <Card title="Recent attendance">
                  {s.attendance.recent.length === 0 ? <p className="text-sm text-ink-500">No records yet.</p> : (
                    <ul className="space-y-1 text-sm">{s.attendance.recent.map((r, i) => (
                      <li key={i} className="flex justify-between"><span>{formatDate(r.date)} · {r.class}</span><Badge tone={r.status === "present" ? "green" : r.status === "absent" ? "red" : "amber"}>{r.status}</Badge></li>
                    ))}</ul>
                  )}
                </Card>
                <Card title="Released grades">
                  {s.learning.released_grades.length === 0 ? <p className="text-sm text-ink-500">No grades released yet.</p> : (
                    <ul className="space-y-2 text-sm">{s.learning.released_grades.map((g, i) => (
                      <li key={i}><p className="flex justify-between font-medium"><span>{g.assignment}</span><span>{Number(g.score)}/{Number(g.out_of)}</span></p>{g.feedback && <p className="text-ink-600">{g.feedback}</p>}</li>
                    ))}</ul>
                  )}
                </Card>
                <Card title="Classes"><ul className="text-sm">{s.classes.map((c) => <li key={c.id}>{c.name}{c.subject && ` · ${c.subject}`}</li>)}</ul></Card>
                <ParentConsent studentId={s.student.id} name={s.student.name} consent={consent as ConsentRow} />
              </div>
              <p className="text-xs text-ink-500">Monitoring only happens during live lessons, on the device your child uses for the lesson. SwiftCipher never monitors time outside class.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
