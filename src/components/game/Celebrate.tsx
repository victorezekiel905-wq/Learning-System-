import { cn } from "@/lib/utils";
import { avatarFor } from "@/components/live/avatars";
import { OptionShape } from "./Shape";

/*
 * SwiftCipher's illustration style: the answer-tile shapes (bolt, star, hexagon,
 * moon, heart, cloud) in their own colours, floating, bursting and stacking.
 * Purely decorative (aria-hidden); prefers-reduced-motion stills all of it.
 */

const GLYPH_TEXT = ["text-tile-bolt", "text-tile-star", "text-tile-hex", "text-tile-moon", "text-tile-heart", "text-tile-cloud"];

// Fixed spots (no randomness, so server and browser draw the same picture).
const FIELD = [
  // Edges only, so the shapes never sit on text: left and right bands, top and bottom corners.
  { x: 4, y: 10, s: 36, r: -14, d: 0 }, { x: 91, y: 7, s: 30, r: 18, d: 1.2 }, { x: 92, y: 78, s: 40, r: -8, d: 2.1 },
  { x: 5, y: 82, s: 32, r: 22, d: 0.6 }, { x: 2, y: 46, s: 26, r: 12, d: 2.6 }, { x: 95, y: 44, s: 26, r: -20, d: 1.7 },
  { x: 20, y: 3, s: 22, r: 10, d: 3 }, { x: 76, y: 92, s: 24, r: -16, d: 0.9 }
]

/** Floating tile shapes behind a dark or light panel (lobbies, end screens, the hero). */
export function GlyphField({ className, count = FIELD.length, opacity = 0.9 }: { className?: string; count?: number; opacity?: number }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} style={{ opacity }}>
      {FIELD.slice(0, count).map((g, i) => (
        <span key={i} className={cn("absolute animate-float", GLYPH_TEXT[i % GLYPH_TEXT.length])}
          style={{ left: `${g.x}%`, top: `${g.y}%`, width: g.s, height: g.s, ["--r" as string]: `${g.r}deg`, animationDelay: `${-g.d}s`, transform: `rotate(${g.r}deg)` }}>
          <OptionShape i={i} className="h-full w-full" />
        </span>
      ))}
    </div>
  );
}

const BURST = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2 + (i % 2 ? 0.2 : 0);
  const dist = 90 + (i % 4) * 28;
  return { dx: Math.round(Math.cos(a) * dist), dy: Math.round(Math.sin(a) * dist * 0.8 - 30), spin: (i % 2 ? 1 : -1) * (120 + i * 15), size: 14 + (i % 3) * 6 };
});

/** Tile shapes flying out from the middle, once: a right answer, a podium place. Replay with a new key. */
export function Burst({ className, delay = 0 }: { className?: string; delay?: number }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 grid place-items-center overflow-visible", className)}>
      {BURST.map((b, i) => (
        <span key={i} className={cn("absolute animate-burst", GLYPH_TEXT[i % GLYPH_TEXT.length])}
          style={{ ["--dx" as string]: `${b.dx}px`, ["--dy" as string]: `${b.dy}px`, ["--spin" as string]: `${b.spin}deg`, animationDelay: `${delay + (i % 4) * 40}ms`, width: b.size, height: b.size }}>
          <OptionShape i={i} className="h-full w-full" />
        </span>
      ))}
    </div>
  );
}

export type PodiumEntry = { name: string; avatar: string | null; score: number; rank: number };

const STEP = {
  1: { h: "h-44 sm:h-52", bg: "bg-tile-star text-ink-950", delay: "0.9s", label: "1st" },
  2: { h: "h-32 sm:h-36", bg: "bg-tile-bolt text-white", delay: "0.45s", label: "2nd" },
  3: { h: "h-24 sm:h-28", bg: "bg-tile-hex text-white", delay: "0s", label: "3rd" }
} as const;

/**
 * The top three on stepped blocks: third rises first, then second, then the winner
 * with a burst. Order on screen is 2nd, 1st, 3rd. Used on the projector and at the end.
 */
export function Podium({ entries, size = "lg", highlight }: { entries: PodiumEntry[]; size?: "md" | "lg"; highlight?: string }) {
  const top = [2, 1, 3].map((r) => entries.find((e) => e.rank === r)).filter(Boolean) as PodiumEntry[];
  if (!top.length) return null;
  const lg = size === "lg";
  return (
    <ol className="mx-auto flex w-full max-w-3xl items-end justify-center gap-3 sm:gap-5" aria-label="Podium">
      {top.map((e) => {
        const st = STEP[e.rank as 1 | 2 | 3];
        return (
          <li key={`${e.rank}-${e.name}`} className="flex w-1/3 max-w-[13rem] flex-col items-center" aria-label={`${st.label}: ${e.name}, ${e.score.toLocaleString()} points`}>
            <div className="relative flex flex-col items-center animate-pop" style={{ animationDelay: `calc(${st.delay} + .35s)` }}>
              {e.rank === 1 && <Burst delay={1300} />}
              <span aria-hidden className={cn("grid place-items-center rounded-2xl bg-white/10", lg ? "h-20 w-20 text-5xl" : "h-14 w-14 text-3xl",
                e.name === highlight && "ring-4 ring-accent-400")}>{avatarFor(e.avatar) ?? "🙂"}</span>
              <span className={cn("mt-2 max-w-full truncate font-display font-extrabold", lg ? "text-2xl" : "text-base")}>{e.name}</span>
              <span className={cn("font-display font-bold tabular-nums text-white/70", lg ? "text-lg" : "text-sm")}>{e.score.toLocaleString()}</span>
            </div>
            <div className="mt-3 w-full overflow-hidden rounded-t-2xl">
              <div className={cn("flex w-full items-start justify-center pt-3 font-display font-extrabold animate-rise", st.h, st.bg, lg ? "text-4xl" : "text-2xl")}
                style={{ animationDelay: st.delay }}>{st.label}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
