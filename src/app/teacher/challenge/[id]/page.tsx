import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import LiveLeaderboard from "@/components/challenge/LiveLeaderboard";
import ChallengeControls from "@/components/challenge/ChallengeControls";

export default async function ChallengeRoom({ params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: game } = await sb.from("game_sessions").select("*").eq("id", params.id).maybeSingle();
  if (!game) return <main className="mx-auto max-w-3xl px-6 py-12">Game not found.</main>;
  const { data: players } = await sb.from("game_players").select("*").eq("game_id", params.id).order("score", { ascending: false });

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-brand-600">Fusion Challenge · Lobby</p>
          <h1 className="text-3xl font-bold">Join code: <span className="font-mono text-brand-600">{game.join_code}</span></h1>
          <p className="mt-1 text-sm text-slate-500">
            Students enter the code at <Link href="/student/game" className="font-medium text-brand-600">/student/game</Link>.
            {game.state === "running" && <> Current question: <span className="font-mono">#{Math.max(0, (game.current_question ?? 0) + 1)}</span></>}
          </p>
        </div>
        <ChallengeControls gameId={game.id} started={game.state === "running"} />
      </header>
      {game.state === "running" && (
        <div className="card mb-6 flex flex-wrap items-center justify-between gap-2 p-4">
          <p className="text-sm">
            Current question <span className="font-mono font-semibold">#{Math.max(0, (game.current_question ?? 0) + 1)}</span>
            {game.question_started_at && <> · started {new Date(game.question_started_at).toLocaleTimeString()}</>}
          </p>
        </div>
      )}
      <LiveLeaderboard gameId={game.id} initial={players ?? []} />
    </main>
  );
}
