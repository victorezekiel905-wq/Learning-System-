import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function Dashboard() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await sb.from("users").select("id,tenant_id,role,full_name").eq("id", user.id).maybeSingle();
  if (!me) redirect("/student/join");

  if (me.role === "student") {
    const { data: memberships } = await sb
      .from("class_members").select("class_id,classes(id,name,join_code)").eq("user_id", user.id);
    const classIds = (memberships ?? [])
      .map((m: { classes: { id: string } | null }) => m.classes?.id)
      .filter(Boolean) as string[];
    const { data: sessions } = classIds.length
      ? await sb.from("class_sessions")
          .select("id,mode,join_code,state,started_at,classes(name)")
          .in("class_id", classIds).in("state", ["scheduled", "live"])
          .order("created_at", { ascending: false }).limit(10)
      : { data: [] };
    const { data: myAnswers } = await sb
      .from("activity_responses").select("id,correct,awarded").eq("student_id", user.id).limit(500);

    const correct = (myAnswers ?? []).filter((a: { correct: boolean }) => a.correct).length;
    return (
      <main className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-8">
          <p className="text-sm font-medium text-brand-600">Student Dashboard</p>
          <h1 className="text-2xl font-semibold">Hi, {me.full_name}</h1>
        </header>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="card p-5"><p className="text-xs uppercase text-slate-500">Classes</p><p className="mt-1 text-2xl font-bold">{memberships?.length ?? 0}</p></div>
          <div className="card p-5"><p className="text-xs uppercase text-slate-500">Answers submitted</p><p className="mt-1 text-2xl font-bold">{(myAnswers ?? []).length}</p></div>
          <div className="card p-5"><p className="text-xs uppercase text-slate-500">Accuracy</p><p className="mt-1 text-2xl font-bold">{(myAnswers ?? []).length ? Math.round((correct / (myAnswers ?? []).length) * 100) : 0}%</p></div>
        </section>

        <section className="card mt-6 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your live sessions</h2>
            <Link href="/student/join" className="btn btn-primary text-xs">+ Join a class</Link>
          </div>
          {(sessions ?? []).length === 0 && <p className="py-6 text-center text-sm text-slate-400">No upcoming sessions.</p>}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {(sessions ?? []).map((s: { id: string; mode: string; join_code: string; state: string; classes: { name: string } | null }) => (
              <div key={s.id} className={s.state === "live" ? "rounded-lg border border-brand-200 bg-brand-50 p-4" : "rounded-lg border border-slate-200 p-4"}>
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{s.classes?.name ?? "Class"}</p>
                  <span className={"rounded-full px-2 py-0.5 text-xs " + (s.state === "live" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600")}>{s.state}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">Mode: {s.mode} · Code: {s.join_code}</p>
                {s.state === "live" && <Link href={`/student/live/${s.id}`} className="btn btn-primary mt-3 w-full text-xs">Open lesson</Link>}
              </div>
            ))}
          </div>
        </section>
      </main>
    );
  }

  // Teacher / admin dashboard
  const [{ data: classes }, { data: lessons }, { data: sessions }, { data: devices }, { data: envEvents }] = await Promise.all([
    sb.from("classes").select("id,name,join_code").order("created_at", { ascending: false }).limit(10),
    sb.from("lessons").select("id,title,status").order("created_at", { ascending: false }).limit(10),
    sb.from("class_sessions").select("id,state,join_code,started_at,classes(name)").order("created_at", { ascending: false }).limit(10),
    sb.from("devices").select("id,status,last_seen_at").limit(200),
    sb.from("environment_events").select("id,severity,acknowledged,ts,students:users!environment_events_student_id_fkey(full_name)").order("ts", { ascending: false }).limit(10)
  ]);
  const online = (devices ?? []).filter((d: { status: string; last_seen_at: string | null }) => d.status === "active" && d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 120_000).length;
  const critical = (envEvents ?? []).filter((e: { severity: string; acknowledged: boolean }) => e.severity === "critical" && !e.acknowledged).length;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <p className="text-sm font-medium text-brand-600">Teacher Dashboard</p>
        <h1 className="text-2xl font-semibold">Good to see you, {me.full_name}</h1>
      </header>

      <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: "Classes", value: classes?.length ?? 0, href: "/teacher/classes" },
          { label: "Lessons", value: lessons?.length ?? 0, href: "/teacher/studio" },
          { label: "Sessions", value: sessions?.length ?? 0, href: "/teacher/live" },
          { label: "Devices online", value: online, href: "/teacher/guard" },
          { label: "Unacked alerts", value: critical, href: "/teacher/live" }
        ].map(c => (
          <Link key={c.label} href={c.href} className="card p-5 hover:border-brand-400">
            <p className="text-xs uppercase text-slate-500">{c.label}</p>
            <p className="mt-1 text-2xl font-bold">{c.value}</p>
          </Link>
        ))}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">Recent sessions</h2>
          {(sessions ?? []).length === 0 && <p className="py-4 text-sm text-slate-400">No sessions yet — start one from Fusion Live.</p>}
          <ul className="divide-y divide-slate-100">
            {(sessions ?? []).map((s: { id: string; state: string; join_code: string; started_at: string | null; classes: { name: string } | null }) => (
              <li key={s.id} className="flex items-center justify-between py-2.5 text-sm">
                <span>{s.classes?.name ?? "Class"} <span className="font-mono text-xs text-slate-400">{s.join_code}</span></span>
                <span className={"rounded-full px-2 py-0.5 text-xs " + (s.state === "live" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500")}>{s.state}</span>
              </li>
            ))}
          </ul>
          <Link href="/teacher/live" className="btn btn-ghost mt-3 w-full text-xs">Open Fusion Live →</Link>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-lg font-semibold">Recent environment alerts</h2>
          {(envEvents ?? []).length === 0 && <p className="py-4 text-sm text-slate-400">No alerts yet.</p>}
          <ul className="divide-y divide-slate-100">
            {(envEvents ?? []).map((e: { id: string; kind: string; severity: string; acknowledged: boolean; ts: string; students: { full_name: string } | null }) => (
              <li key={e.id} className="flex items-center justify-between py-2.5 text-sm">
                <span>{e.students?.full_name ?? "Student"} — {e.kind}</span>
                <span className={"rounded-full px-2 py-0.5 text-xs " + (e.severity === "critical" ? "bg-rose-100 text-rose-700" : e.severity === "warn" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500")}>{e.severity}{e.acknowledged ? " · acked" : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
