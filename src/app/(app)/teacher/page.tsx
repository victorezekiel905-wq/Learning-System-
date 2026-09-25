import Link from "next/link";
import { ArrowRight, Plus, Radio } from "lucide-react";
import { requireRole, TEACHERS } from "@/lib/session";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { cn, dayPart, firstName, formatDateTime, timeAgo } from "@/lib/utils";

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
  const liveNow = live.data ?? [];
  const openAlerts = (alerts.data ?? []).length;
  const name = firstName(me.profile.full_name);

  const stats = [
    { label: "Classes", value: myClasses.length, href: "/teacher/classes" },
    { label: "Awaiting review", value: pending.count ?? 0, href: "/teacher/review" },
    { label: "Open alerts", value: openAlerts, href: liveNow[0] ? `/teacher/live/${liveNow[0].id}` : "/teacher/reports", red: openAlerts > 0 },
    { label: "Recent lessons", value: (lessons.data ?? []).length, href: "/teacher/lessons" }
  ];

  return (
    <div className="page">
      <PageHeader eyebrow={me.tenant?.name} title={`Good ${dayPart(me.tenant?.timezone)}${name ? `, ${name}` : ""}.`}
        subtitle="Here is what needs you today."
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
                <p className="mt-3 truncate font-display text-2xl font-extrabold tracking-tight">{s.title}</p>
                <p className="mt-1 text-sm text-ink-400">Started {timeAgo(s.started_at)}</p>
              </div>
              <div className="rounded-xl bg-accent-500 px-4 py-2 text-accent-ink">
                <p className="text-[11px] font-semibold">Join code</p>
                <p className="font-mono text-2xl font-extrabold tracking-[0.18em]">{s.join_code}</p>
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
            <p className="flex items-center justify-between text-[13px] font-semibold text-ink-500">{s.label}
              <ArrowRight className="h-3.5 w-3.5 -translate-x-1 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100" aria-hidden /></p>
            <p className={cn("mt-3 font-display text-[40px] font-extrabold leading-none tracking-tightest tabular-nums", s.red ? "text-rose-700" : "text-ink-900")}>{s.value}</p>
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
                  <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-100 font-display text-sm font-extrabold text-ink-800">
                    {(c.subject ?? c.name).slice(0, 2)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/teacher/classes/${c.id}`} className="block truncate font-semibold text-ink-900 no-underline hover:underline">{c.name}</Link>
                    <p className="text-[13px] text-ink-500">{c.subject ?? "No subject"} · code <span className="font-mono font-semibold text-ink-700">{c.join_code}</span></p>
                  </div>
                  <Link href={`/teacher/live/new?class=${c.id}`} className="btn btn-secondary btn-sm no-underline"><Radio className="h-3.5 w-3.5" aria-hidden />Go live</Link>
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
          <Card title="Coming up">
            {(assignments.data ?? []).length === 0 ? <p className="text-sm text-ink-500">Nothing due soon.</p> : (
              <ul className="space-y-3 text-sm">
                {(assignments.data ?? []).map((a) => (
                  <li key={a.id}><Link href={`/teacher/assignments/${a.id}`} className="font-medium text-ink-900">{a.title}</Link><span className="block text-[13px] text-ink-500">Due {formatDateTime(a.due_at)}</span></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
