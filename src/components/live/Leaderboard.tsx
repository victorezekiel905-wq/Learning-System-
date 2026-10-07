import { cn } from "@/lib/utils";
import { avatarFor } from "./avatars";

export type BoardEntry = { name: string; avatar: string | null; score: number; rank: number; delta?: number };

const MEDAL = ["bg-accent-500 text-accent-ink", "bg-white text-ink-950", "bg-amber-300 text-ink-950"];

/** Top of the class, game-show style. Lower ranks are never shown to the class. */
export function Leaderboard({ entries, size = "md", highlight }: { entries: BoardEntry[]; size?: "md" | "lg"; highlight?: string }) {
  const lg = size === "lg";
  if (!entries.length) return <p className={cn("text-center text-ink-300", lg ? "text-2xl" : "text-sm")}>No points yet.</p>;
  return (
    <ol className={cn("w-full space-y-2", lg && "space-y-3")}>
      {entries.map((e) => (
        <li key={`${e.rank}-${e.name}`}
          className={cn("flex items-center gap-3 rounded-2xl bg-white/10 px-4 text-white", lg ? "py-4 text-2xl" : "py-2.5", e.name === highlight && "ring-2 ring-accent-400")}>
          <span className={cn("grid shrink-0 place-items-center rounded-full font-display font-extrabold", lg ? "h-12 w-12 text-2xl" : "h-8 w-8 text-sm",
            MEDAL[e.rank - 1] ?? "bg-white/15 text-white")}>{e.rank}</span>
          <span aria-hidden className={lg ? "text-3xl" : "text-xl"}>{avatarFor(e.avatar) ?? "🙂"}</span>
          <span className="min-w-0 flex-1 truncate font-semibold">{e.name}</span>
          {e.delta ? <span className={cn("text-sm font-bold", e.delta > 0 ? "text-accent-400" : "text-rose-300")} aria-label={e.delta > 0 ? `up ${e.delta}` : `down ${-e.delta}`}>
            {e.delta > 0 ? `▲${e.delta}` : `▼${-e.delta}`}</span> : null}
          <span className="font-display font-extrabold tabular-nums">{e.score.toLocaleString()}</span>
        </li>
      ))}
    </ol>
  );
}
