import Link from "next/link";
import { requireRole } from "@/lib/session";
import { Alert, Badge, Card, Empty, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";
import { ProgressPanel } from "./ProgressPanel";

export const metadata = { title: "Home" };

type Home = {
  classes: { id: string; name: string; subject: string | null; teacher: string; teacher_id: string }[];
  live: { id: string; title: string; class: string; environment_active: boolean; started_at: string }[];
  games: { id: string; title: string; join_code: string; status: string; class: string }[];
  assignments: { id: string; title: string; due_at: string | null; class: string; activity_id: string | null; submitted: boolean; points_possible: number; late_allowed: boolean }[];
  feedback: { kind: string; title: string; score: number | null; out_of: number; feedback: string | null; at: string }[];
  scores: { activity: string; score: number | null; max: number | null; status: string; at: string }[];
  devices: number;
};

export default async function StudentHome() {
  const { me, sb } = await requireRole(["student"]);
  const { data } = await sb.rpc("student_home");
  const h = data as Home;
  const todo = h.assignments.filter((a) => !a.submitted);

  return (
    <div className="page">
      <PageHeader title={`Hi, ${me.profile.full_name.split(" ")[0]}`} subtitle="Your classes, live lessons and work."
        actions={<Link href="/student/join" className="btn btn-primary no-underline">Join with code</Link>} />

      {me.settings?.welcome_message && <div className="mb-5 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">{me.settings.welcome_message}</div>}

      {h.live.map((s) => (
        <Link key={s.id} href={`/student/live/${s.id}`} className="mb-3 flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 no-underline">
          <span className="font-semibold text-emerald-900">● {s.class} is live: {s.title}</span><span className="btn btn-primary btn-sm">Join now</span>
        </Link>
      ))}
      {h.games.map((g) => (
        <Link key={g.id} href={`/student/game/${g.id}`} className="mb-3 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 no-underline">
          <span className="font-semibold text-amber-900">🏆 Challenge open: {g.title} ({g.class})</span><span className="btn btn-accent btn-sm">Play</span>
        </Link>
      ))}
      {h.live.some((s) => s.environment_active) && h.devices > 0 && (
        <div className="mb-4"><Alert>A managed class session is active. While it runs, your teacher can see the site you're on and a low-resolution picture of your screen. <Link href="/student/device">What's shared?</Link></Alert></div>
      )}

      <ProgressPanel />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" title={`To do (${todo.length})`}>
          {todo.length === 0 ? <p className="text-sm text-ink-500">You're all caught up. 🎉</p> : (
            <ul className="divide-y divide-ink-100">
              {todo.map((a) => {
                const overdue = a.due_at && new Date(a.due_at) < new Date();
                return (
                  <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div><Link href={`/student/assignments/${a.id}`} className="font-medium">{a.title}</Link><p className="text-xs text-ink-500">{a.class}{a.due_at && ` · due ${formatDateTime(a.due_at)}`}</p></div>
                    {overdue ? <Badge tone={a.late_allowed ? "amber" : "red"}>{a.late_allowed ? "Late" : "Closed"}</Badge> : <Badge tone="brand">Open</Badge>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card title="My classes">
          {h.classes.length === 0 ? <Empty title="No classes yet" action={<Link href="/student/join" className="btn btn-primary no-underline">Enter a class code</Link>} /> : (
            <ul className="space-y-2 text-sm">{h.classes.map((c) => (
              <li key={c.id} className="flex items-center justify-between"><span><span className="font-medium">{c.name}</span><span className="block text-xs text-ink-500">{c.teacher}</span></span>
                <Link href={`/messages?class=${c.id}`} className="text-xs">Message teacher</Link></li>
            ))}</ul>
          )}
        </Card>
        <Card className="lg:col-span-2" title="Feedback">
          {h.feedback.length === 0 ? <p className="text-sm text-ink-500">Feedback from your teachers appears here.</p> : (
            <ul className="space-y-3">{h.feedback.map((f, i) => (
              <li key={i} className="rounded-lg bg-ink-50 p-3 text-sm">
                <p className="flex justify-between font-medium"><span>{f.title}</span>{f.score !== null && <span className="tabular-nums">{Number(f.score)}/{Number(f.out_of)}</span>}</p>
                {f.feedback && <p className="mt-1 text-ink-700">{f.feedback}</p>}
              </li>
            ))}</ul>
          )}
        </Card>
        <Card title="Recent scores">
          {h.scores.length === 0 ? <p className="text-sm text-ink-500">No activities yet.</p> : (
            <ul className="space-y-2 text-sm">{h.scores.map((s, i) => (
              <li key={i} className="flex justify-between"><span className="truncate">{s.activity}</span>
                <span className="tabular-nums text-ink-600">{s.max ? `${Number(s.score ?? 0)}/${Number(s.max)}` : "done"}{s.status === "submitted" && "*"}</span></li>
            ))}</ul>
          )}
          <p className="hint mt-2">* waiting for teacher review</p>
        </Card>
      </div>
    </div>
  );
}
