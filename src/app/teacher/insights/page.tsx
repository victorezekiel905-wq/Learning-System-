import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function InsightsPage() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: lessons }, { data: classes }, { data: responses }, { data: sessions }, { data: devices }, { data: envEvents }] = await Promise.all([
    sb.from("lessons").select("id,status"),
    sb.from("classes").select("id"),
    sb.from("activity_responses").select("id,correct,awarded,submitted_at").order("submitted_at", { ascending: false }).limit(500),
    sb.from("class_sessions").select("id,state"),
    sb.from("devices").select("id,status,last_seen_at,kinds:kind").limit(300),
    sb.from("environment_events").select("id,severity,acknowledged,ts").order("ts", { ascending: false }).limit(200)
  ]);

  const res = (responses ?? []) as { id: string; correct: boolean }[];
  const correct = res.filter((r) => r.correct).length;
  const avgElapsed = res.length ? "—" : "—";
  void avgElapsed;
  const published = (lessons ?? []).filter((l: { status: string }) => l.status === "published").length;
  const liveSessions = (sessions ?? []).filter((s: { state: string }) => s.state === "live").length;
  const online = (devices ?? []).filter((d: { status: string; last_seen_at: string | null }) => d.status === "active" && d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 120_000).length;
  const unacked = (envEvents ?? []).filter((e: { acknowledged: boolean }) => !e.acknowledged).length;
  const bySeverity = (envEvents ?? []).reduce((acc: Record<string, number>, e: { severity: string }) => { acc[e.severity] = (acc[e.severity] ?? 0) + 1; return acc; }, {} as Record<string, number>);

  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 86400_000);
    const key = d.toISOString().slice(0, 10);
    return { date: key, count: (envEvents ?? []).filter((e: { ts: string }) => e.ts.slice(0, 10) === key).length };
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <p className="text-sm font-medium text-brand-600">Fusion Insights</p>
        <h1 className="text-2xl font-semibold">Learning & classroom analytics</h1>
        <p className="mt-1 text-sm text-slate-500">Learning signals (responses) and device telemetry (alerts, connectivity) are kept separate per blueprint §18.</p>
      </header>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Lessons", value: lessons?.length ?? 0, sub: `${published} published` },
          { label: "Classes", value: classes?.length ?? 0, sub: "active" },
          { label: "Responses", value: res.length, sub: `${res.length ? Math.round((correct / res.length) * 100) : 0}% correct` },
          { label: "Sessions", value: sessions?.length ?? 0, sub: `${liveSessions} live now` },
          { label: "Devices online", value: online, sub: `${devices?.length ?? 0} enrolled` },
          { label: "Unacked alerts", value: unacked, sub: `of ${envEvents?.length ?? 0} total` }
        ].map(c => (
          <div key={c.label} className="card p-4">
            <p className="text-xs uppercase text-slate-500">{c.label}</p>
            <p className="mt-1 text-2xl font-bold">{c.value}</p>
            <p className="text-xs text-slate-400">{c.sub}</p>
          </div>
        ))}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">Environment alerts — last 7 days</h2>
          <div className="flex h-40 items-end gap-2">
            {last7.map(d => (
              <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs font-semibold text-brand-700">{d.count}</span>
                <div className="w-full rounded-t bg-gradient-to-t from-brand-600 to-violet-500" style={{ height: `${Math.max(4, (d.count / Math.max(1, ...last7.map(x => x.count))) * 120)}px` }} />
                <span className="text-[10px] text-slate-400">{d.date.slice(5)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">Alert severity mix</h2>
          <ul className="space-y-2">
            {(["critical", "warn", "info"] as const).map(s => (
              <li key={s} className="flex items-center justify-between text-sm">
                <span className="capitalize">{s}</span>
                <span className="font-mono">{bySeverity[s] ?? 0}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 rounded-md bg-slate-50 p-3 text-xs text-slate-500">
            Per blueprint §3.8, alerts are assistive signals — no automatic disciplinary action is derived from them.
          </p>
        </section>
      </div>
    </main>
  );
}
