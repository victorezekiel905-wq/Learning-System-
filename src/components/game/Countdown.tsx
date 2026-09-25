"use client";
import { useNow } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/** Countdown driven by server timestamps corrected for clock skew. */
export function Countdown({ endsAt, serverNow, fetchedAt, total, className }: {
  endsAt: string | null; serverNow: string; fetchedAt: number; total: number; className?: string;
}) {
  const now = useNow(250);
  if (!endsAt) return null;
  if (total === 0) return <p className={cn("text-sm font-medium text-ink-600", className)}>No timer: take your time and think it through.</p>;
  const skew = new Date(serverNow).getTime() - fetchedAt;
  const left = Math.max(0, (new Date(endsAt).getTime() - (now + skew)) / 1000);
  const frac = Math.min(1, left / total);
  return (
    <div className={cn("flex items-center gap-3", className)} aria-live="off">
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-ink-200">
        <div className={cn("h-full rounded-full transition-[width] duration-200", frac < 0.25 ? "bg-rose-500" : "bg-brand-500")} style={{ width: `${frac * 100}%` }} />
      </div>
      <span className="w-10 text-right font-mono text-lg font-bold tabular-nums">{Math.ceil(left)}</span>
    </div>
  );
}
