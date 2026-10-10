"use client";
import { useRpc } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { OptionShape } from "./Shape";
import { OPTION_COLORS } from "./types";

/** One team's standing (migration 1090). Team n is named and coloured after answer tile n. */
export type TeamScore = { team: number; name: string; score: number; members: number; mine: boolean };

export function useTeamScores(sessionId: string, refresh: unknown, enabled = true) {
  return useRpc<TeamScore[]>("session_team_scores", { p_session: sessionId }, [sessionId, refresh], { intervalMs: 8000, enabled });
}

/** Team bars, biggest score first. */
export function TeamStandings({ teams, big }: { teams: TeamScore[]; big?: boolean }) {
  if (!teams.length) return null;
  const top = Math.max(1, ...teams.map((t) => t.score));
  return (
    <ol className={cn("w-full space-y-2", big && "space-y-3")} aria-label="Team scores">
      {teams.map((t) => (
        <li key={t.team} className={cn("flex items-center gap-3", big ? "text-2xl" : "text-sm")}>
          <span className={cn("grid shrink-0 place-items-center rounded-xl", OPTION_COLORS[(t.team - 1) % OPTION_COLORS.length], big ? "h-12 w-12" : "h-8 w-8")}>
            <OptionShape i={t.team - 1} className={big ? "h-6 w-6" : "h-4 w-4"} />
          </span>
          <span className={cn("shrink-0 font-semibold", big ? "w-44 sm:w-60" : "w-32 sm:w-40")}>{t.name}{t.mine && <span className="ml-1 text-xs font-normal opacity-70">(you)</span>}</span>
          <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-white/10 sm:h-4">
            <span className={cn("absolute inset-y-0 left-0 rounded-full", OPTION_COLORS[(t.team - 1) % OPTION_COLORS.length])} style={{ width: `${(t.score / top) * 100}%` }} />
          </span>
          <span className="w-20 text-right font-display font-extrabold tabular-nums">{t.score.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}

/** "Team Bolt", with its shape: shown to a student in the lesson. */
export function TeamChip({ team }: { team: TeamScore }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-bold", OPTION_COLORS[(team.team - 1) % OPTION_COLORS.length])}>
      <OptionShape i={team.team - 1} className="h-3.5 w-3.5" />{team.name}
    </span>
  );
}
