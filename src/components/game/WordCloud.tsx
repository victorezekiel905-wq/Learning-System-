"use client";
import { useRpc } from "@/lib/hooks";
import { cn } from "@/lib/utils";

export type CloudWord = { word: string; count: number };

const COLORS = ["text-tile-bolt", "text-tile-hex", "text-tile-moon", "text-tile-heart", "text-tile-cloud"];
const ON_DARK = ["text-tile-star", "text-white", "text-[#8FA6FF]", "text-[#F0A8E4]", "text-[#7FE0D2]"];

/** The class's words (migration 1090): bigger the more people chose them, in the tile colours. */
export function WordCloud({ words, dark, big }: { words: CloudWord[]; dark?: boolean; big?: boolean }) {
  if (!words.length) return <p className={cn("text-center", dark ? "text-ink-300" : "text-ink-500", big ? "text-2xl" : "text-sm")}>Words appear here as answers arrive.</p>;
  const most = Math.max(...words.map((w) => w.count));
  const palette = dark ? ON_DARK : COLORS;
  // Biggest in the middle: alternate the words to either side of the most common.
  const ordered: CloudWord[] = [];
  words.forEach((w, i) => (i % 2 ? ordered.push(w) : ordered.unshift(w)));
  return (
    <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2" aria-label="Word cloud">
      {ordered.map((w, i) => {
        const t = most > 1 ? (w.count - 1) / (most - 1) : 1;
        const size = (big ? 22 : 15) + t * (big ? 58 : 26);
        return (
          <li key={w.word} className={cn("animate-pop font-display font-extrabold leading-tight", palette[i % palette.length])} style={{ fontSize: size }}
            title={`${w.word}: ${w.count}`}>
            {w.word}<span className="sr-only"> ({w.count})</span>
          </li>
        );
      })}
    </ul>
  );
}

/** Live words for one activity in a session, refreshed every few seconds. */
export function useWordCloud(activityId: string | null | undefined, sessionId: string, enabled = true) {
  return useRpc<CloudWord[]>("session_word_cloud", { p_activity: activityId, p_session: sessionId }, [activityId, sessionId], { intervalMs: 3000, enabled: enabled && !!activityId });
}
