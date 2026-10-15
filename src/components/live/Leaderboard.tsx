import { cn, LOCALE } from "@/lib/utils";
import { Critter } from "./Critter";

export type BoardEntry = { name: string; avatar: string | null; score: number; rank: number; delta?: number };

// The podium's colours: 1st lime star, 2nd cobalt bolt, 3rd magenta hexagon.
const MEDAL = ["bg-tile-star text-ink-950", "bg-tile-bolt text-white", "bg-tile-hex text-white"];

/** Top of the class, game-show style. Lower ranks are never shown to the class. */
export function Leaderboard({ entries, size = "md", highlight }: { entries: BoardEntry[]; size?: "md" | "lg"; highlight?: string }) {
  const lg = size === "lg";
  if (!entries.length) return <p className={cn("text-center text-ink-300", lg ? "text-2xl" : "text-sm")}>No points yet.</p>;
  return (
    <ol className={cn("w-full space-y-2", lg && "space-y-3")}>
      {entries.map((e) => (
        <li key={`${e.rank}-${e.name}`}
          className={cn("flex items-center gap-3 rounded-2xl bg-white/[0.07] px-4 text-white ring-1 ring-inset ring-white/10", lg ? "py-3 text-lg sm:py-4 sm:text-2xl" : "py-2.5", e.name === highlight && "ring-2 ring-accent-400")}>
          <span className={cn("grid shrink-0 place-items-center rounded-full font-display font-extrabold", lg ? "h-10 w-10 text-xl sm:h-12 sm:w-12 sm:text-2xl" : "h-8 w-8 text-sm",
            MEDAL[e.rank - 1] ?? "bg-white/15 text-white")}>{e.rank}</span>
          <Critter name={e.avatar} className={lg ? "h-8 w-8 sm:h-10 sm:w-10" : "h-7 w-7"} />
          <span className="line-clamp-2 min-w-0 flex-1 break-words font-semibold leading-tight">{e.name}</span>
          {e.delta ? <span className={cn("text-sm font-bold", e.delta > 0 ? "text-accent-400" : "text-rose-300")} aria-label={e.delta > 0 ? `up ${e.delta}` : `down ${-e.delta}`}>
            {e.delta > 0 ? `▲${e.delta}` : `▼${-e.delta}`}</span> : null}
          <span className="font-display font-extrabold tabular-nums">{e.score.toLocaleString(LOCALE)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Everyone below the podium on the projector: compact rows in columns, so a whole class fits. */
export function RankGrid({ entries }: { entries: BoardEntry[] }) {
  if (!entries.length) return null;
  return (
    <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="Everyone else">
      {entries.map((e) => (
        <li key={`${e.rank}-${e.name}`} className="flex items-center gap-3 rounded-xl bg-white/[0.07] px-3 py-2 text-white ring-1 ring-inset ring-white/10">
          <span className="w-8 shrink-0 text-right font-display text-lg font-extrabold tabular-nums text-ink-300">{e.rank}</span>
          <Critter name={e.avatar} className="h-7 w-7 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-base font-semibold sm:text-lg">{e.name}</span>
          {e.delta ? <span className={cn("text-xs font-bold", e.delta > 0 ? "text-accent-400" : "text-rose-300")} aria-label={e.delta > 0 ? `up ${e.delta}` : `down ${-e.delta}`}>
            {e.delta > 0 ? `▲${e.delta}` : `▼${-e.delta}`}</span> : null}
          <span className="shrink-0 font-display text-lg font-extrabold tabular-nums">{e.score.toLocaleString(LOCALE)}</span>
        </li>
      ))}
    </ol>
  );
}
