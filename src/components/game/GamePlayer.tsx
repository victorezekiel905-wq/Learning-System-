"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Question = { question_id: string; prompt: string; options: string[]; points: number; index: number; total: number };
type Player = { id: string; nickname: string; score: number; streak: number };
type Board = { state: string; podium: Player[]; ranking: Player[] };

export default function GamePlayer({ gameId }: { gameId: string }) {
  const [game, setGame] = useState<{ id: string; state: string } | null>(null);
  const [nickname, setNickname] = useState("");
  const [joined, setJoined] = useState(false);
  const [question, setQuestion] = useState<Question | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [pick, setPick] = useState("");
  const [result, setResult] = useState<{ correct: boolean; awarded: number; score: number } | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [g, q, b] = await Promise.all([
      fetch(`/api/games/${gameId}/question`).then((r) => r.json()),
      fetch(`/api/games/${gameId}/question`).then((r) => r.json()),
      fetch(`/api/games/${gameId}/leaderboard`).then((r) => r.json())
    ]);
    setGame({ id: gameId, state: g.state });
    setQuestion(q.question ?? null);
    setStartedAt(q.question_started_at ?? null);
    setBoard(b);
  }, [gameId]);

  useEffect(() => {
    refresh();
    const sb = createClient();
    const ch = sb.channel(`game-play-${gameId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_sessions", filter: `id=eq.${gameId}` }, () => refresh())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "leaderboard_entries", filter: `game_id=eq.${gameId}` }, () => refresh())
      .subscribe();
    const t = setInterval(refresh, 4000);
    return () => { clearInterval(t); sb.removeChannel(ch); };
  }, [gameId, refresh]);

  async function join() {
    setErr(null);
    if (!nickname.trim()) { setErr("Pick a nickname"); return; }
    const r = await fetch(`/api/games/${gameId}/join`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: nickname.trim() })
    });
    if (!r.ok) { setErr((await r.json()).error ?? "join failed"); return; }
    setJoined(true);
  }

  async function answer() {
    if (!question || !pick) return;
    setErr(null);
    const r = await fetch(`/api/games/${gameId}/answer`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question_id: question.question_id, response: pick, nickname: nickname.trim() })
    });
    if (!r.ok) { setErr((await r.json()).error ?? "answer failed"); return; }
    setResult(await r.json());
    refresh();
  }

  if (!game) return <main className="mx-auto max-w-2xl px-6 py-16"><p className="text-slate-500">Loading game…</p></main>;

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-brand-600">Fusion Challenge</p>
          <h1 className="text-2xl font-bold">Game lobby <span className={"ml-2 rounded-full px-2 py-0.5 text-xs " + (game.state === "running" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700")}>{game.state}</span></h1>
        </div>
        <Link href="/student/join" className="btn btn-ghost text-xs">← Back</Link>
      </header>

      {!joined ? (
        <section className="card space-y-3 p-6">
          <label className="label">Your display name</label>
          <input className="input" maxLength={16} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="e.g. Alex" />
          {err && <p className="text-sm text-rose-600">{err}</p>}
          <button className="btn btn-primary w-full" onClick={join}>Join game</button>
          <p className="text-xs text-slate-400">Wait in the lobby — the teacher starts the quiz and questions appear one by one.</p>
        </section>
      ) : (
        <div className="space-y-4">
          {question && game.state === "running" ? (
            <section className="card p-6">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Question {question.index + 1} / {question.total}</span>
                <span>{question.points} pts</span>
              </div>
              <h2 className="mt-2 text-xl font-semibold">{question.prompt}</h2>
              {result ? (
                <div className={"mt-4 rounded-md p-4 text-center text-lg font-bold " + (result.correct ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>
                  {result.correct ? `✓ Correct! +${result.awarded} pts` : "✗ Not this time"}
                  <p className="mt-1 text-sm font-normal text-slate-500">Your score: {result.score} — waiting for the next question…</p>
                </div>
              ) : (
                <>
                  <div className="mt-4 grid gap-2">
                    {(question.options ?? []).map((opt) => (
                      <button key={opt} onClick={() => setPick(opt)}
                        className={"rounded-md border px-4 py-3 text-left text-sm " + (pick === opt ? "border-brand-500 bg-brand-50" : "border-slate-200 hover:bg-slate-50")}>
                        {opt}
                      </button>
                    ))}
                  </div>
                  {err && <p className="mt-2 text-sm text-rose-600">{err}</p>}
                  <button className="btn btn-primary mt-4 w-full" disabled={!pick} onClick={answer}>Submit</button>
                </>
              )}
            </section>
          ) : (
            <section className="card p-6 text-center text-slate-500">
              {game.state === "running" ? "Waiting for the next question…" : "The quiz hasn't started yet. Watch the screen!"}
              {startedAt && <p className="mt-1 text-xs text-slate-400">Started {new Date(startedAt).toLocaleTimeString()}</p>}
            </section>
          )}

          {board && (
            <section className="card p-6">
              <h2 className="mb-3 text-lg font-semibold">Leaderboard</h2>
              {board.podium.length > 0 && (
                <div className="mb-4 flex items-end justify-center gap-3">
                  {board.podium.map((p, i) => (
                    <div key={p.id} className={"rounded-t-lg px-4 py-3 text-center " + (i === 0 ? "bg-amber-100" : i === 1 ? "bg-slate-100" : "bg-orange-100")}>
                      <p className="text-2xl">{["🥇", "🥈", "🥉"][i]}</p>
                      <p className="text-sm font-semibold">{p.nickname}</p>
                      <p className="text-xs">{p.score}</p>
                    </div>
                  ))}
                </div>
              )}
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">#</th><th>Player</th><th>Score</th><th>Streak</th></tr></thead>
                <tbody>
                  {board.ranking.map((p, i) => (
                    <tr key={p.id} className="border-t border-slate-100">
                      <td className="py-2">{i + 1}</td>
                      <td className="font-medium">{p.nickname}</td>
                      <td>{p.score}</td>
                      <td>{p.streak > 0 ? "🔥".repeat(Math.min(p.streak, 5)) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
