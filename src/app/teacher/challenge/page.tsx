import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function ChallengeIndex() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { data: games } = await sb.from("game_sessions")
    .select("id,join_code,state,created_at,classes(name)")
    .order("created_at", { ascending: false })
    .limit(30);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <p className="text-sm font-medium text-brand-600">Fusion Challenge</p>
          <h1 className="text-2xl font-semibold">Game-based quizzes</h1>
          <p className="mt-1 text-sm text-slate-500">Competitive quiz games with live leaderboards, streaks and speed scoring.</p>
        </div>
        <Link href="/teacher/challenge/new" className="btn btn-primary">+ New game</Link>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(games ?? []).length === 0 && (
          <div className="card col-span-full p-10 text-center text-slate-500">
            No games yet — pick an activity and start a lobby.
          </div>
        )}
        {(games ?? []).map((g: { id: string; join_code: string; state: string; created_at: string; classes: { name: string } | null }) => (
          <Link key={g.id} href={`/teacher/challenge/${g.id}`} className="card p-5 hover:border-brand-400">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{g.classes?.name ?? "Class"}</h3>
              <span className={"rounded-full px-2 py-0.5 text-xs " + (g.state === "running" ? "bg-emerald-100 text-emerald-700" : g.state === "lobby" ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-500")}>{g.state}</span>
            </div>
            <p className="mt-1 text-sm">Code: <span className="font-mono text-brand-600">{g.join_code}</span></p>
            <p className="mt-1 text-xs text-slate-400">{new Date(g.created_at).toLocaleString()}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
