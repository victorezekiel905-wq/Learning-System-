"use client";
import { useEffect, useRef } from "react";
import { Check } from "lucide-react";
import { useNow } from "@/lib/hooks";
import { cn } from "@/lib/utils";
import { OptionShape } from "./Shape";
import { OPTION_COLORS } from "./types";

/** The countdown of a live question (migration 0940): one clock for the class, from the server. */
export type LiveTimer = { activity_id: string; started_at: string; seconds: number; ends_at: string };

/** Seconds left, corrected for this device's clock (skew = server time − local time when the state arrived). */
export function useSecondsLeft(timer: LiveTimer | null | undefined, skew: number) {
  const now = useNow(200);
  if (!timer) return null;
  return Math.max(0, (new Date(timer.ends_at).getTime() - (now + skew)) / 1000);
}

/** A ring that empties as time runs out. Calls onDone once at zero, onSecond each whole second. */
export function TimerRing({ timer, skew, size = 64, onDone, onSecond, className }: {
  timer: LiveTimer; skew: number; size?: number; onDone?: () => void; onSecond?: (left: number) => void; className?: string;
}) {
  const left = useSecondsLeft(timer, skew) ?? 0;
  const whole = Math.ceil(left);
  const done = useRef<string | null>(null);
  const lastSecond = useRef<number | null>(null);
  useEffect(() => {
    if (left <= 0 && done.current !== timer.ends_at) { done.current = timer.ends_at; onDone?.(); }
    if (whole !== lastSecond.current) { lastSecond.current = whole; onSecond?.(whole); }
  }, [left, whole, timer.ends_at, onDone, onSecond]);
  const frac = Math.min(1, left / Math.max(timer.seconds, 1));
  const r = 45, c = 2 * Math.PI * r;
  const late = left <= 5;
  return (
    <div className={cn("relative shrink-0", className)} style={{ width: size, height: size }}
      role="timer" aria-label={`${whole} seconds left`}>
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth="9" />
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="9" strokeLinecap="round"
          className={cn("transition-[stroke-dashoffset] duration-200 ease-linear", late ? "stroke-rose-500" : "stroke-accent-400")}
          strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
      </svg>
      <span className={cn("absolute inset-0 grid place-items-center font-display font-extrabold tabular-nums", late && left > 0 && "animate-pulse")}
        style={{ fontSize: size * 0.36 }}>{whole}</span>
    </div>
  );
}

type Option = { id: string; label: string };

/**
 * Coloured answer tiles with shapes. Phones tap them; the projector shows them
 * (and, after the reveal, how many chose each and which was right).
 */
export function AnswerTiles({ options, onPick, picked = [], disabled, correct, counts, big, className }: {
  options: Option[]; onPick?: (id: string) => void; picked?: string[]; disabled?: boolean;
  /** After the reveal: the right options; the others fade. */
  correct?: string[];
  counts?: Record<string, number>;
  big?: boolean; className?: string;
}) {
  return (
    <div className={cn("grid gap-3", options.length > 2 || big ? "grid-cols-2" : "grid-cols-1 sm:grid-cols-2", className)}>
      {options.map((o, i) => {
        const right = correct?.includes(o.id);
        const faded = correct && !right;
        const Tag = onPick ? "button" : "div";
        return (
          <Tag key={o.id} {...(onPick ? { type: "button" as const, disabled, onClick: () => onPick(o.id), "aria-pressed": picked.includes(o.id) } : {})}
            className={cn("relative flex items-center gap-3 rounded-2xl text-left font-semibold text-white shadow-[inset_0_-6px_0_rgb(0_0_0/0.18)] transition",
              OPTION_COLORS[i % OPTION_COLORS.length],
              big ? "min-h-[7rem] px-7 py-5 text-3xl" : "min-h-[5.5rem] px-4 py-4 text-lg sm:min-h-[6.5rem] sm:text-xl",
              onPick && !disabled && "active:translate-y-0.5 active:shadow-none hover:brightness-110",
              picked.includes(o.id) && "ring-4 ring-ink-950 ring-offset-2",
              faded && "opacity-35", disabled && !picked.includes(o.id) && !correct && "opacity-60")}>
            <OptionShape i={i} className={big ? "h-10 w-10 shrink-0" : "h-7 w-7 shrink-0"} />
            <span className="min-w-0 flex-1 break-words">{o.label}</span>
            {counts && <span className="font-display tabular-nums">{counts[o.id] ?? 0}</span>}
            {right && <Check className={big ? "h-10 w-10" : "h-7 w-7"} strokeWidth={3} aria-label="Right answer" />}
          </Tag>
        );
      })}
    </div>
  );
}

/** After the reveal on the projector: a column per answer, Kahoot style. */
export function AnswerBars({ options, counts, correct }: { options: Option[]; counts: Record<string, number>; correct: string[] }) {
  const most = Math.max(1, ...options.map((o) => counts[o.id] ?? 0));
  return (
    <div className="flex h-72 items-end justify-center gap-6">
      {options.map((o, i) => {
        const n = counts[o.id] ?? 0;
        const right = correct.includes(o.id);
        return (
          <div key={o.id} className={cn("flex w-28 flex-col items-center gap-2", !right && correct.length > 0 && "opacity-40")}>
            <span className="flex items-center gap-1 font-display text-4xl font-extrabold tabular-nums">{right && <Check className="h-8 w-8" strokeWidth={3} />}{n}</span>
            <div className={cn("w-full rounded-t-xl", OPTION_COLORS[i % OPTION_COLORS.length])} style={{ height: `${Math.max(6, (n / most) * 180)}px` }} />
            <span className={cn("grid h-10 w-full place-items-center rounded-b-xl text-white", OPTION_COLORS[i % OPTION_COLORS.length])}><OptionShape i={i} className="h-6 w-6" /></span>
          </div>
        );
      })}
    </div>
  );
}
