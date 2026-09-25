"use client";
import { useRpc } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import type { GameGoal } from "./types";

/** Class goal mode: one bar for the whole class, no rankings (migration 0800). */
export function GoalBar({ gameId, refreshKey, className }: { gameId: string; refreshKey: unknown; className?: string }) {
  const goal = useRpc<GameGoal>("game_goal", { p_game: gameId }, [gameId, refreshKey]);
  const g = goal.data;
  if (!g?.enabled || g.target <= 0) return null;
  const pct = Math.min(100, Math.round((g.correct / g.target) * 100));
  const reached = g.correct >= g.target;
  return (
    <div className={cn("rounded-2xl p-5", reached ? "bg-accent-500 text-accent-ink" : "bg-ink-950 text-white", className)} role="status">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-display text-lg font-extrabold">{reached ? "Class goal reached!" : "Class goal"}</p>
        <p className="text-sm font-semibold tabular-nums">{g.correct} of {g.target} correct answers</p>
      </div>
      <div className={cn("mt-3 h-3 overflow-hidden rounded-full", reached ? "bg-ink-900/15" : "bg-white/15")}>
        <div className={cn("h-full rounded-full transition-[width] duration-500", reached ? "bg-ink-900" : "bg-accent-500")} style={{ width: `${pct}%` }} />
      </div>
      <p className={cn("mt-2 text-[13px]", reached ? "opacity-80" : "text-ink-300")}>Every right answer from anyone moves the class forward. Goal: {g.goal_percent}% of all answers correct.</p>
    </div>
  );
}
