import Link from "next/link";
import { requireRole, ADMINS } from "@/lib/session";
import { Card, PageHeader, Stat } from "@/components/ui";
import { Line } from "@/components/charts";

export const metadata = { title: "School admin" };

type Overview = { teachers: number; students: number; parents: number; classes: number; lessons: number; devices_active: number; devices_online: number; weekly: { week: string; sessions: number; participants: number; answers: number }[] };

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
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${st.done ? "bg-emerald-500 text-white" : "bg-ink-200 text-ink-600"}`}>{st.done ? "✓" : i + 1}</span>
              <Link href={st.href} className={st.done ? "text-ink-500 line-through" : ""}>{st.label}</Link>
            </li>
          ))}</ol>
        </Card>
        <Card title="Engagement: live sessions per week (last 12 weeks)">
          <Line data={o.weekly.map((w) => ({ label: w.week, value: w.sessions }))} />
          <p className="mt-2 text-xs text-ink-500">{o.weekly.reduce((a, w) => a + w.participants, 0)} student joins · {o.weekly.reduce((a, w) => a + w.answers, 0)} answers</p>
        </Card>
      </div>
    </div>
  );
}
