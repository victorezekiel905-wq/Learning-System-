"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Player = { id: string; nickname: string; score: number; streak: number };

export default function LiveLeaderboard({ gameId, initial }: { gameId: string; initial: Player[] }) {
  const [players, setPlayers] = useState<Player[]>(initial);

  useEffect(() => {
    const sb = createClient();
    const channel = sb.channel(`game-${gameId}`)
      .on("postgres_changes",
          { event: "*", schema: "public", table: "game_players", filter: `game_id=eq.${gameId}` },
          (payload: any) => {
            setPlayers((cur) => {
              const next = [...cur];
              if (payload.eventType === "DELETE") return next.filter(p => p.id !== (payload.old as Player).id);
              const row = payload.new as Player;
              const idx = next.findIndex(p => p.id === row.id);
              if (idx >= 0) next[idx] = row; else next.push(row);
              return next.sort((a, b) => b.score - a.score);
            });
          })
      .subscribe();
    return () => { sb.removeChannel(channel); };
  }, [gameId]);

  return (
    <section className="card p-6">
      <h2 className="mb-4 text-lg font-semibold">Leaderboard</h2>
      <table className="w-full text-left">
        <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">#</th><th>Nickname</th><th>Score</th><th>Streak</th></tr></thead>
        <tbody>
          {players.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-slate-500">Waiting for players…</td></tr>}
          {players.map((p, i) => (
            <tr key={p.id} className="border-t border-slate-100">
              <td className="py-2 font-mono">{i + 1}</td>
              <td className="font-medium">{p.nickname}</td>
              <td>{p.score}</td>
              <td>{p.streak > 0 ? "🔥".repeat(Math.min(p.streak, 5)) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
