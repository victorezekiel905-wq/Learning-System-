import Link from "next/link";
import { ArrowRight, Plus, Radio } from "lucide-react";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { cn, dayPart, firstName, formatDateTime, formatJoinCode, timeAgo } from "@/lib/utils";

export type TeacherHomeData = {
  school: string | null; timezone?: string; name: string; welcome: string | null;
  classes: { id: string; name: string; subject: string | null; join_code: string }[];
  live: { id: string; title: string; join_code: string; started_at: string; class_id: string | null }[];
  lessons: { id: string; title: string; status: string; updated_at: string }[];
  sessions30: number; openAlerts: number;
  /** Lessons the teacher has made, parent feedback waiting for their reply, and whether the school has monitoring. */
  lessonCount?: number; feedbackWaiting?: number; monitoring?: boolean;
  recent: { id: string; title: string; ended_at: string }[];
};

/** The teacher's home page, drawn from plain data (the page loads it). */
export function TeacherHomeView({ d }: { d: TeacherHomeData }) {
  const myClasses = d.classes;
  const liveNow = d.live;
  const openAlerts = d.openAlerts;
  const name = firstName(d.name);
  const lessons = { data: d.lessons };
  const recent = { data: d.recent };
  const me = { tenant: { name: d.school ?? undefined, timezone: d.timezone }, settings: { welcome_message: d.welcome } };
  const stats = [
    { label: "Classes", value: myClasses.length, href: "/teacher/classes" },
    { label: "Lessons", value: d.lessonCount ?? d.lessons.length, href: "/teacher/lessons" },
    { label: "Taught in the last 30 days", value: d.sessions30, href: "/teacher/reports" },
    d.monitoring
      ? { label: "Open alerts", value: openAlerts, href: liveNow[0] ? `/teacher/live/${liveNow[0].id}` : "/teacher/reports", red: openAlerts > 0 }
      : { label: "Parent feedback waiting", value: d.feedbackWaiting ?? 0, href: "/teacher/feedback", red: false }
  ];

  return (
    <div className="page">
      <PageHeader title={`Good ${dayPart(me.tenant?.timezone)}${name ? `, ${name}` : ""}.`}
        subtitle="Your classes, your lessons, and what is waiting for you."
        actions={<>
          <Link href="/teacher/lessons?new=1" className="btn btn-secondary no-underline"><Plus className="h-4 w-4" aria-hidden />New lesson</Link>
          <Link href="/teacher/challenge/new" className="btn btn-secondary no-underline"><Icon name="trophy" className="h-4 w-4" />New challenge</Link>
          <Link href="/teacher/live/new" className="btn btn-primary no-underline"><Radio className="h-4 w-4" aria-hidden />Start live class</Link>
        </>} />

      {me.settings?.welcome_message && <div className="mb-6 rounded-2xl border border-ink-200 bg-white px-5 py-4 text-[15px] text-ink-800"><span className="mr-2 font-semibold">From your school:</span>{me.settings.welcome_message}</div>}

      {liveNow.length > 0 && (
        <div className="mb-6 space-y-3">
          {liveNow.map((s) => (
            <Link key={s.id} href={`/teacher/live/${s.id}`}
              className="group flex flex-wrap items-center gap-x-6 gap-y-4 rounded-2xl bg-ink-950 p-5 text-white no-underline hover:text-white sm:p-6">
              <div className="min-w-0 flex-1 basis-56">
                <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-1.5 py-1 text-[11px] font-bold leading-none">
                  <span className="h-1.5 w-1.5 animate-pulse2 rounded-full bg-white" aria-hidden />LIVE NOW</span>
                <p className="mt-3 truncate font-display text-2xl font-bold tracking-tight">{s.title}</p>
                <p className="mt-1 text-sm text-ink-400">Started {timeAgo(s.started_at)}</p>
              </div>
              <div className="rounded-xl bg-accent-500 px-4 py-2 text-accent-ink">
                <p className="text-[11px] font-semibold">Join code</p>
                <p className="font-mono text-2xl font-extrabold tracking-[0.18em]">{formatJoinCode(s.join_code)}</p>
              </div>
              <span className="btn btn-lg bg-white text-ink-900 group-hover:bg-ink-100">Open the room <ArrowRight className="h-4 w-4" aria-hidden /></span>
            </Link>
          ))}
        </div>
      )}

      {/* One strip of numbers rather than four boxes: 2×2 on phones, one row on desktop. */}
      <div className="card grid grid-cols-2 overflow-hidden lg:grid-cols-4">
        {stats.map((s, i) => (
          <Link key={s.label} href={s.href}
            className={cn("group block border-ink-200 p-5 no-underline transition-colors hover:bg-ink-50 sm:p-6",
              i % 2 === 0 && "border-r", i < 2 && "border-b lg:border-b-0", i === 1 && "lg:border-r", i === 2 && "lg:border-r")}>
            <p className="flex items-center justify-between text-[13px] font-medium text-ink-500">{s.label}
              <ArrowRight className="h-3.5 w-3.5 -translate-x-1 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" aria-hidden /></p>
            <p className={cn("mt-3 font-display text-[30px] font-bold leading-none tracking-[-0.02em] tabular-nums", s.red ? "text-rose-700" : "text-ink-900")}>{s.value}</p>
          </Link>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Your classes" actions={<Link href="/teacher/classes" className="text-[13px] font-semibold">Manage classes</Link>} pad={myClasses.length === 0}>
          {myClasses.length === 0 ? (
            <Empty title="No classes yet" icon={<Icon name="users" />} action={<Link href="/teacher/classes" className="btn btn-primary no-underline">Create a class</Link>}>
              Create a class, then share its join code with your students.
            </Empty>
          ) : (
            <ul className="divide-y divide-ink-100">
              {myClasses.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 sm:px-6">
                  <div className="min-w-0 flex-1">
                    <Link href={`/teacher/classes/${c.id}`} className="block truncate font-semibold text-ink-900 no-underline hover:underline">{c.name}</Link>
                    <p className="text-[13px] text-ink-500">{c.subject ?? "No subject"} · class code <span className="font-mono text-ink-700">{c.join_code}</span></p>
                  </div>
                  <Link href={`/teacher/live/new?class=${c.id}`} className="btn btn-ghost btn-sm no-underline text-ink-700"><Radio className="h-3.5 w-3.5" aria-hidden />Go live</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Recent lessons" actions={<Link href="/teacher/lessons" className="text-[13px] font-semibold">All lessons</Link>}>
            {(lessons.data ?? []).length === 0 ? <p className="text-sm text-ink-500">No lessons yet.</p> : (
              <ul className="space-y-3 text-sm">
                {(lessons.data ?? []).map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2">
                    <Link href={`/teacher/lessons/${l.id}`} className="truncate font-medium text-ink-900">{l.title}</Link>
                    <Badge tone={l.status === "published" ? "green" : "gray"}>{l.status === "published" ? "Published" : "Draft"}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Recent sessions" actions={<Link href="/teacher/reports" className="text-[13px] font-semibold">All reports</Link>}>
            {(recent.data ?? []).length === 0 ? <p className="text-sm text-ink-500">Sessions you run appear here, with their reports.</p> : (
              <ul className="space-y-3 text-sm">
                {(recent.data ?? []).map((r) => (
                  <li key={r.id}><Link href={`/teacher/reports?session=${r.id}`} className="font-medium text-ink-900">{r.title}</Link><span className="block text-[13px] text-ink-500">Ended {formatDateTime(r.ended_at)}</span></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
