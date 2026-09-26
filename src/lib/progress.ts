// Shared shapes and labels for XP, levels, badges and challenge levels (migration 0790).

export type Progress = {
  xp: number; level: number; level_floor: number; next_level_xp: number; week_xp: number;
  badges: { badge: string; earned_at: string }[];
  recent: { points: number; reason: string; at: string }[];
  classes: { class_id: string; name: string; level: 1 | 2 | 3; level_set_by: string; choice_enabled: boolean; leaderboard_enabled: boolean }[];
};

export const BADGE_LABEL: Record<string, string> = {
  first_steps: "First steps", rising_star: "Rising star", scholar: "Scholar", deep_thinker: "Deep thinker",
  perfectionist: "Perfectionist", challenger: "Challenger", shout_out: "Teacher shout-out", game_on: "Game on",
  author: "Question author"
};

export const BADGE_HINT: Record<string, string> = {
  first_steps: "Earned your first XP", rising_star: "Reached 100 XP", scholar: "Reached 1,000 XP",
  deep_thinker: "Explained your reasoning 10 times", perfectionist: "Got a perfect score",
  challenger: "Chose the Extension challenge", shout_out: "Your teacher gave you a shout-out", game_on: "Played 3 class games",
  author: "Wrote a question your teacher added to a quiz"
};

export const CHALLENGE: Record<1 | 2 | 3, { name: string; hint: string }> = {
  1: { name: "Support", hint: "Build confidence with guided questions" },
  2: { name: "Core", hint: "The main level for the class" },
  3: { name: "Extension", hint: "Stretch yourself with harder problems" }
};

export const BLOOM: { v: string; label: string; hint: string }[] = [
  { v: "remember", label: "Remember", hint: "Recall facts" },
  { v: "understand", label: "Understand", hint: "Explain ideas" },
  { v: "apply", label: "Apply", hint: "Use it in a new situation" },
  { v: "analyze", label: "Analyse", hint: "Compare, find patterns" },
  { v: "evaluate", label: "Evaluate", hint: "Judge, justify a choice" },
  { v: "create", label: "Create", hint: "Produce something new" }
];
