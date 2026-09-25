import type { GameSettings, PublicQuestion } from "@/lib/types";

export type GameState = {
  id: string; title: string; status: "lobby" | "question" | "review" | "ended"; join_code: string;
  current_index: number; total: number; question_started_at: string | null; question_ends_at: string | null;
  server_now: string; settings: GameSettings; is_host: boolean; players: number;
  question?: PublicQuestion; answered?: number;
  review?: { correct_option_ids: string[]; explanation: string | null; distribution: Record<string, number> };
  roster?: { player_id: string; name: string; full_name: string; team_id: string | null; answered: boolean }[];
  flags?: number;
  me?: { player_id: string; name: string; score: number; streak: number; answered: boolean; last?: { is_correct: boolean; points: number } };
};

export type Leaderboard = {
  visible: boolean; status: string; players: number;
  top: { rank: number; player_id: string; name: string; score: number; correct: number; streak: number; badges: string[]; team_id: string | null }[];
  teams: { team_id: string; name: string; color: string; score: number; members: number }[] | null;
  me: { player_id: string; name: string; score: number; streak: number; correct: number; rank: number; badges: string[] } | null;
};

export const BADGE: Record<string, string> = {
  gold: "1st place", silver: "2nd place", bronze: "3rd place", podium: "Podium",
  perfect: "Perfect score", streak_5: "5-answer streak", speedster: "Fastest correct answers"
};

// White text on every colour passes WCAG AA; each answer also has a shape so colour is never the only cue.
export const OPTION_COLORS = ["bg-rose-700", "bg-blue-700", "bg-amber-700", "bg-emerald-700", "bg-violet-700", "bg-teal-700"];
export const OPTION_SHAPES = ["triangle", "diamond", "circle", "square", "hexagon", "star"] as const;

export type GameGoal = { enabled: boolean; correct: number; target: number; possible_so_far: number; goal_percent: number };
