import Link from "next/link";
import { requireRole, ADMINS } from "@/lib/session";
import { Card, PageHeader, Stat } from "@/components/ui";
import { Bars } from "@/components/charts";
import { Icon } from "@/components/Icon";

export const metadata = { title: "School admin" };

type Overview = { teachers: number; students: number; parents: number; classes: number; lessons: number; devices_active: number; devices_online: number; weekly: { week: string; sessions: number; participants: number; answers: number }[] };

/** The database only returns weeks that had lessons; the chart shows all twelve, empty ones as 0.
    Weeks start on Monday (UTC), as Postgres date_trunc('week') does. */
function lastTwelveWeeks(rows: Overview["weekly"]) {
  const byWeek = new Map(rows.map((r) => [r.week.slice(0, 10), r.sessions]));
  const now = new Date();
  const monday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(monday - (11 - i) * 7 * 86_400_000);
    return { label: d.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" }), value: byWeek.get(d.toISOString().slice(0, 10)) ?? 0 };
  });
}

export default async function AdminHome() {
  const { me, sb } = await requireRole(ADMINS);
  const [{ data }, { count: envCount }, { count: inviteCount }] = await Promise.all([
    sb.rpc("tenant_overview"),
    sb.from("environment_policies").select("id", { count: "exact", head: true }),
    sb.from("invites").select("id", { count: "exact", head: true })
  ]);
  const o = data as Overview;
  const s = me.settings!;
  const steps = [
    { done: true, label: "Create your school workspace", href: "/admin/settings" },
    { done: (inviteCount ?? 0) > 0 || o.teachers > 1, label: "Invite teachers and IT staff", href: "/admin/users" },
    { done: o.classes > 0, label: "Create classes and import rosters (CSV)", href: "/teacher/classes" },
    { done: (envCount ?? 0) > 0, label: "Set up an environment template (allowed/blocked sites)", href: "/guard/environments" },
    { done: o.devices_active > 0, label: "Enrol managed browsers with the extension", href: "/guard" },
    { done: s.monitoring_notice_version > 1 || s.telemetry_retention_days !== 30, label: "Review the privacy notice and retention periods", href: "/admin/settings" }
  ];

  return (
    <div className="page">
      <PageHeader eyebrow="SwiftCipher Admin" title={me.tenant?.name ?? "School"} subtitle={`${me.plan?.name} plan`} />
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Teachers" value={o.teachers} /><Stat label="Students" value={o.students} /><Stat label="Parents" value={o.parents} />
        <Stat label="Classes" value={o.classes} /><Stat label="Lessons" value={o.lessons} /><Stat label="Devices online" value={`${o.devices_online}/${o.devices_active}`} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Setup checklist">
          <ol className="space-y-2">{steps.map((st, i) => (
            <li key={i} className="flex items-center gap-3 text-sm">
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${st.done ? "bg-emerald-700 text-white" : "bg-ink-200 text-ink-600"}`}>{st.done ? <Icon name="check" className="h-3.5 w-3.5" /> : i + 1}{st.done && <span className="sr-only">Done</span>}</span>
              <Link href={st.href} className={st.done ? "text-ink-500 line-through" : "font-medium no-underline hover:underline"}>{st.label}</Link>
            </li>
          ))}</ol>
        </Card>
        <Card title="Live lessons per week (last 12 weeks)">
          {o.weekly.every((w) => w.sessions === 0) ? (
            <p className="text-sm text-ink-600">No live lessons yet. They appear here week by week once teachers start teaching live.</p>
          ) : (
            <Bars data={lastTwelveWeeks(o.weekly)} />
          )}
          <p className="mt-3 text-[13px] text-ink-500">{o.weekly.reduce((a, w) => a + w.participants, 0)} student joins · {o.weekly.reduce((a, w) => a + w.answers, 0)} answers</p>
        </Card>
      </div>
    </div>
  );
}
