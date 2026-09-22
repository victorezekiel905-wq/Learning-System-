import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function LiveIndex() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { data: sessions } = await sb
    .from("class_sessions")
    .select("id, state, mode, join_code, started_at, class_id, classes(name)")
    .order("created_at", { ascending: false })
    .limit(20);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <p className="text-sm font-medium text-brand-600">Fusion Live</p>
          <h1 className="text-2xl font-semibold">Live classroom sessions</h1>
        </div>
        <Link href="/teacher/live/new" className="btn btn-primary">+ New session</Link>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(sessions ?? []).length === 0 && (
          <div className="card col-span-full p-10 text-center text-slate-500">
            No sessions yet.
          </div>
        )}
        {(sessions ?? []).map((s: { id: string; state: string; mode: string; join_code: string; classes: { name: string } | null }) => (
          <Link key={s.id} href={`/teacher/live/${s.id}`} className="card p-5 hover:border-brand-400">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{s.classes?.name ?? "Class"}</h3>
              <span className={"rounded-full px-2 py-0.5 text-xs " + ({
                live: "bg-emerald-100 text-emerald-700",
                scheduled: "bg-slate-100 text-slate-700",
                ended: "bg-slate-200 text-slate-500"
              } as Record<string,string>)[s.state]}>{s.state}</span>
            </div>
            <p className="mt-1 text-sm text-slate-500">Mode: {s.mode}</p>
            <p className="mt-2 text-xs">Code: <span className="font-mono text-brand-600">{s.join_code}</span></p>
          </Link>
        ))}
      </div>
    </main>
  );
}
