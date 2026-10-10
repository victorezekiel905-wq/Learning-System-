import type { ImportedQuestion } from "./question-import";
import type { QuestionKind } from "./types";

/** One question as Claude drafts it (the schema in ai-questions.ts). */
export type AiDraft = {
  kind: "mcq" | "multi_select" | "true_false" | "short" | "fill_blank";
  prompt: string; options: { label: string; is_correct: boolean }[]; answers: string[]; explanation: string; topic: string;
};

/** Into the importer's shape, dropping anything that doesn't hold together. */
export function toImported(q: AiDraft): ImportedQuestion | null {
  const prompt = q.prompt.trim();
  if (!prompt) return null;
  const base: ImportedQuestion = {
    kind: q.kind as QuestionKind, prompt, points: q.kind === "short" ? 5 : 1,
    explanation: q.explanation.trim() || null, topic: q.topic.trim() || null, options: [], config: {}, answer_key: {}
  };
  if (q.kind === "mcq" || q.kind === "multi_select" || q.kind === "true_false") {
    const options = q.options.map((o) => ({ label: o.label.trim(), is_correct: o.is_correct })).filter((o) => o.label);
    const right = options.filter((o) => o.is_correct).length;
    if (options.length < 2 || !right || ((q.kind === "mcq" || q.kind === "true_false") && right !== 1)) return null;
    return { ...base, options };
  }
  if (q.kind === "fill_blank") {
    const blanks = (prompt.match(/_{3,}/g) ?? []).length;
    const answers = q.answers.map((a) => a.trim()).filter(Boolean);
    if (!blanks || answers.length < blanks) return null;
    return { ...base, answer_key: { blanks: answers.slice(0, blanks).map((a) => [a]) } };
  }
  // Short answer: the model answer goes to the teacher as the explanation, as the importer does.
  const model = q.answers[0]?.trim();
  return { ...base, explanation: [model && `Expected answer: ${model}`, base.explanation].filter(Boolean).join(" ") || null };
}
