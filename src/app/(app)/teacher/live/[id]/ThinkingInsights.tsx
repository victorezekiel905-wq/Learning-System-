"use client";
import { Badge } from "@/components/ui";
import { BLOOM } from "@/lib/progress";

export type Insight = {
  question_id: string; prompt: string; bloom_level: string | null; difficulty: number | null;
  answers: number; correct: number; confident_wrong: number; unsure_right: number;
  reasoning: { student: string; correct: boolean | null; confidence: number | null; text: string }[];
};

const BLOOM_LABEL = Object.fromEntries(BLOOM.map((b) => [b.v, b.label]));

/**
 * Critical-thinking view for one question: confident-but-wrong answers (likely
 * misconceptions to address with the class), right-but-unsure (needs confidence),
 * and what students wrote as their reasoning.
 */
export function ThinkingInsights({ insight: i }: { insight: Insight | undefined }) {
  if (!i || (i.answers === 0 && !i.bloom_level)) return null;
  const wrongConfident = i.reasoning.filter((r) => r.correct === false && (r.confidence ?? 0) >= 4);
  return (
    <div className="mt-3 space-y-2 border-t border-ink-100 pt-3">
      <div className="flex flex-wrap gap-2 text-xs">
        {i.bloom_level && <Badge tone="cyan">Bloom: {BLOOM_LABEL[i.bloom_level]}</Badge>}
        {i.difficulty && <Badge>Difficulty {i.difficulty}</Badge>}
        {i.confident_wrong > 0 && <Badge tone="red">{i.confident_wrong} confident but wrong: likely misconception</Badge>}
        {i.unsure_right > 0 && <Badge tone="amber">{i.unsure_right} right but unsure</Badge>}
      </div>
      {i.reasoning.length > 0 && (
        <details open={wrongConfident.length > 0}>
          <summary className="cursor-pointer text-sm font-medium text-ink-700">Students&apos; reasoning ({i.reasoning.length})</summary>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {[...wrongConfident, ...i.reasoning.filter((r) => !wrongConfident.includes(r))].map((r, k) => (
              <li key={k} className={`rounded-lg p-2 text-sm ${r.correct === false && (r.confidence ?? 0) >= 4 ? "bg-rose-50" : "bg-ink-50"}`}>
                <p className="text-xs font-semibold text-ink-600">
                  {r.student} · {r.correct === null ? "not marked" : r.correct ? "correct" : "incorrect"}{r.confidence ? ` · confidence ${r.confidence}/5` : ""}
                </p>
                <p className="whitespace-pre-wrap">{r.text}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
