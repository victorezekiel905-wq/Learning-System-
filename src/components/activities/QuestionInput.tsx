"use client";
import { useState } from "react";
import { RichText } from "@/components/RichText";
import { ReadAloud } from "@/components/ReadAloud";
import { Whiteboard } from "@/components/slides/Whiteboard";
import { Textarea } from "@/components/ui";
import { useSignedUrl } from "@/lib/media";
import { createClient } from "@/lib/supabase/client";
import type { Item, PublicQuestion, Stroke } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CodeRunner, type RunResult } from "./CodeRunner";

export type Answer = Record<string, unknown>;

const LETTERS = "ABCDEFGH";

/**
 * Prompt text with "___" rendered as blanks for fill-in questions, a Read aloud
 * button (question and choices), and credit when a classmate wrote the question.
 */
export function Prompt({ q, readAloud }: { q: PublicQuestion; readAloud?: "offer" | "emphasis" }) {
  const img = useSignedUrl(q.media?.media_path);
  const spoken = [q.prompt, ...q.options.map((o, i) => `${LETTERS[i] ?? ""}: ${o.label}`)].join(". ");
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        {q.kind !== "fill_blank" ? <RichText text={q.prompt} className="min-w-0 text-lg font-semibold text-ink-900" /> : <span />}
        {readAloud && <ReadAloud text={spoken} emphasis={readAloud === "emphasis"} />}
      </div>
      {q.config.authored_by && <p className="text-[13px] font-medium text-ink-500">Question written by {q.config.authored_by}</p>}
      {(img || q.media?.url) && <img src={img ?? q.media.url} alt={q.media.alt ?? ""} className="max-h-64 rounded-lg border border-ink-200" />}
    </div>
  );
}

/** Kinds where a student can (or must) explain their thinking alongside the answer. */
const REASONING_KINDS = new Set(["mcq", "multi_select", "true_false", "short", "fill_blank", "ordering", "matching", "categorize"]);
const MIN_REASONING = 15;
export const requiresReasoning = (q: PublicQuestion) =>
  REASONING_KINDS.has(q.kind) && !!(q.config as { require_reasoning?: boolean }).require_reasoning;

type AnswerProps = {
  q: PublicQuestion;
  value: Answer | undefined;
  onChange: (v: Answer) => void;
  disabled?: boolean;
  uploadPrefix?: string;
  reveal?: { correct_option_ids?: string[] };
};

/**
 * The answer plus, for reasoning-friendly kinds, "Explain your reasoning" and a
 * confidence rating (critical thinking + metacognition). Required when the teacher
 * asks for it; otherwise optional and worth +5 XP.
 */
export function QuestionInput(props: AnswerProps) {
  const { q, value, onChange, disabled } = props;
  const v = value ?? {};
  const reasoning = (v.reasoning as string | undefined) ?? "";
  const confidence = v.confidence as number | undefined;
  const extra = { ...(reasoning ? { reasoning } : {}), ...(confidence ? { confidence } : {}) };
  // Answer widgets replace the whole response; keep the student's reasoning and confidence.
  const widget = <AnswerWidget {...props} onChange={(next) => onChange({ ...next, ...extra })} />;
  if (!REASONING_KINDS.has(q.kind)) return widget;
  const required = requiresReasoning(q);
  const set = (p: Answer) => onChange({ ...v, ...p });
  return (
    <div className="space-y-4">
      {widget}
      <div className={cn("space-y-3 rounded-xl border p-4", required ? "border-brand-200 bg-brand-50/50" : "border-ink-200 bg-ink-50")}>
        <label className="block">
          <span className="label">{required ? "Explain your reasoning (required)" : "Explain your reasoning (optional, +5 XP)"}</span>
          <Textarea rows={3} maxLength={2000} disabled={disabled} value={reasoning}
            placeholder="Why is this your answer? What evidence or steps led you there?"
            onChange={(e) => set({ reasoning: e.target.value })} />
          {required && reasoning.trim().length > 0 && reasoning.trim().length < MIN_REASONING && (
            <span className="hint block">Write at least a full sentence.</span>
          )}
        </label>
        <fieldset>
          <legend className="label">How sure are you?</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup">
            {[["1", "Guessing"], ["2", "Unsure"], ["3", "Fairly sure"], ["4", "Sure"], ["5", "Certain"]].map(([n, label]) => (
              <button key={n} type="button" role="radio" aria-checked={confidence === Number(n)} disabled={disabled}
                onClick={() => set({ confidence: Number(n) })}
                className={cn("rounded-full border px-3 py-1 text-xs font-medium",
                  confidence === Number(n) ? "border-brand-600 bg-brand-600 text-white" : "border-ink-300 bg-white text-ink-700 hover:border-brand-400")}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  );
}

/**
 * Answer widget for every question kind. `value` is the JSON response the
 * server grades (see app.grade_response in migration 0610).
 */
function AnswerWidget({ q, value, onChange, disabled, uploadPrefix, reveal }: AnswerProps) {
  const v = value ?? {};
  switch (q.kind) {
    case "mcq":
    case "true_false":
    case "poll":
      return (
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Choices">
          {q.options.map((o, i) => {
            const selected = v.option_id === o.id;
            const correct = reveal?.correct_option_ids?.includes(o.id);
            return (
              <button key={o.id} type="button" role="radio" aria-checked={selected} disabled={disabled}
                onClick={() => onChange({ option_id: o.id })}
                className={cn("flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left text-sm font-medium transition",
                  selected ? "border-brand-600 bg-brand-50" : "border-ink-200 bg-white hover:border-brand-300",
                  reveal && correct && "border-emerald-500 bg-emerald-50",
                  reveal && selected && !correct && "border-rose-400 bg-rose-50")}>
                <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-bold", selected ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-600")}>{LETTERS[i]}</span>
                <span>{o.label}</span>
              </button>
            );
          })}
        </div>
      );
    case "multi_select": {
      const set = new Set((v.option_ids as string[] | undefined) ?? []);
      return (
        <div className="space-y-2">
          <p className="text-xs text-ink-500">Select all that apply.</p>
          {q.options.map((o) => (
            <label key={o.id} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border-2 px-4 py-3 text-sm",
              set.has(o.id) ? "border-brand-600 bg-brand-50" : "border-ink-200 bg-white",
              reveal?.correct_option_ids?.includes(o.id) && "border-emerald-500")}>
              <input type="checkbox" disabled={disabled} checked={set.has(o.id)} onChange={(e) => {
                const next = new Set(set);
                if (e.target.checked) next.add(o.id); else next.delete(o.id);
                onChange({ option_ids: Array.from(next) });
              }} />
              {o.label}
            </label>
          ))}
        </div>
      );
    }
    case "fill_blank": {
      const parts = q.prompt.split(/_{3,}/);
      const blanks = (v.blanks as string[] | undefined) ?? [];
      return (
        <p className="text-lg leading-loose text-ink-900">
          {parts.map((part, i) => (
            <span key={i}>
              {part}
              {i < parts.length - 1 && (
                <input aria-label={`Blank ${i + 1}`} disabled={disabled} value={blanks[i] ?? ""} className="input mx-1 inline-block w-36 py-1"
                  onChange={(e) => { const next = [...blanks]; next[i] = e.target.value; onChange({ blanks: next }); }} />
              )}
            </span>
          ))}
        </p>
      );
    }
    case "matching": {
      const pairs = (v.pairs as Record<string, string> | undefined) ?? {};
      return (
        <div className="space-y-2">
          {(q.config.left ?? []).map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-ink-200 bg-white p-2">
              <span className="min-w-[8rem] flex-1 font-medium">{l.label}</span>
              <span aria-hidden>→</span>
              <select className="input w-auto min-w-[10rem]" disabled={disabled} value={pairs[l.id] ?? ""} aria-label={`Match for ${l.label}`}
                onChange={(e) => onChange({ pairs: { ...pairs, [l.id]: e.target.value } })}>
                <option value="">Choose…</option>
                {(q.config.right ?? []).map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </div>
          ))}
        </div>
      );
    }
    case "ordering":
      return <OrderingInput items={q.config.items ?? []} order={v.order as string[] | undefined} disabled={disabled} onChange={(order) => onChange({ order })} />;
    case "categorize":
      return <CategorizeInput items={q.config.items ?? []} categories={q.config.categories ?? []}
        placements={(v.placements as Record<string, string> | undefined) ?? {}} disabled={disabled} onChange={(placements) => onChange({ placements })} />;
    case "open":
    case "short":
      return (
        <div>
          <Textarea rows={q.kind === "short" ? 3 : 6} disabled={disabled} maxLength={q.config.max_chars ?? 5000}
            value={(v.text as string) ?? ""} onChange={(e) => onChange({ text: e.target.value })} aria-label="Your answer" placeholder="Type your answer…" />
          <p className="hint text-right">{((v.text as string) ?? "").length}/{q.config.max_chars ?? 5000}</p>
        </div>
      );
    case "draw":
      return <Whiteboard strokes={(v.strokes as Stroke[]) ?? []} editable={!disabled} onChange={(strokes) => onChange({ strokes })} />;
    case "file":
      return <FileAnswer value={v} onChange={onChange} disabled={disabled} prefix={uploadPrefix} />;
    case "code":
      return (
        <CodeRunner language={q.config.language ?? "javascript"} value={(v.source as string) ?? q.config.starter ?? ""} readOnly={disabled}
          tests={q.config.tests} onChange={(source) => onChange({ ...v, source, language: q.config.language ?? "javascript" })}
          onResult={(r: RunResult) => onChange({ ...v, source: (v.source as string) ?? q.config.starter ?? "", language: q.config.language ?? "javascript", run: { error: r.error, tests: r.tests } })} />
      );
    default:
      return null;
  }
}

/** Is the response complete enough to submit? */
export function isAnswered(q: PublicQuestion, v: Answer | undefined): boolean {
  if (!v) return false;
  if (requiresReasoning(q) && ((v.reasoning as string | undefined) ?? "").trim().length < MIN_REASONING) return false;
  switch (q.kind) {
    case "mcq": case "true_false": case "poll": return !!v.option_id;
    case "multi_select": return ((v.option_ids as string[]) ?? []).length > 0;
    case "fill_blank": return ((v.blanks as string[]) ?? []).some((b) => b?.trim());
    case "matching": return Object.values((v.pairs as Record<string, string>) ?? {}).some(Boolean);
    case "ordering": return ((v.order as string[]) ?? []).length > 0;
    case "categorize": return Object.keys((v.placements as object) ?? {}).length > 0;
    case "open": case "short": return !!(v.text as string)?.trim();
    case "draw": return ((v.strokes as unknown[]) ?? []).length > 0;
    case "file": return !!v.path;
    case "code": return !!(v.source as string)?.trim();
    default: return false;
  }
}

function OrderingInput({ items, order, onChange, disabled }: { items: Item[]; order?: string[]; onChange: (o: string[]) => void; disabled?: boolean }) {
  const ids = order && order.length === items.length ? order : items.map((i) => i.id);
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const [drag, setDrag] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x!);
    onChange(next);
  };
  return (
    <ol className="space-y-2">
      {ids.map((id, i) => (
        <li key={id} draggable={!disabled} onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()}
          onDrop={() => { if (drag !== null) move(drag, i); setDrag(null); }}
          className="flex items-center gap-3 rounded-lg border border-ink-200 bg-white px-3 py-2">
          <span className="w-6 text-center font-bold text-ink-500">{i + 1}</span>
          <span className="flex-1 cursor-grab">{byId[id]?.label}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={disabled || i === 0} onClick={() => move(i, i - 1)} aria-label="Move up">↑</button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={disabled || i === ids.length - 1} onClick={() => move(i, i + 1)} aria-label="Move down">↓</button>
        </li>
      ))}
    </ol>
  );
}

function CategorizeInput({ items, categories, placements, onChange, disabled }: {
  items: Item[]; categories: Item[]; placements: Record<string, string>; onChange: (p: Record<string, string>) => void; disabled?: boolean;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const unplaced = items.filter((i) => !placements[i.id]);
  const place = (itemId: string, cat: string) => onChange({ ...placements, [itemId]: cat });
  const chip = (it: Item) => (
    <span key={it.id} draggable={!disabled} onDragStart={() => setDragging(it.id)}
      className="inline-flex cursor-grab items-center gap-1 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-sm shadow-sm">
      {it.label}
      <select aria-label={`Category for ${it.label}`} disabled={disabled} className="ml-1 rounded border-0 bg-transparent text-xs text-ink-500"
        value={placements[it.id] ?? ""} onChange={(e) => place(it.id, e.target.value)}>
        <option value="">—</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
    </span>
  );
  return (
    <div className="space-y-3">
      <div className="flex min-h-[3rem] flex-wrap gap-2 rounded-lg bg-ink-100 p-2">{unplaced.length ? unplaced.map(chip) : <span className="text-xs text-ink-500">All items placed.</span>}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        {categories.map((c) => (
          <div key={c.id} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (dragging) place(dragging, c.id); setDragging(null); }}
            className="min-h-[6rem] rounded-xl border-2 border-dashed border-brand-200 bg-brand-50/50 p-2">
            <p className="mb-2 text-[13px] font-semibold text-ink-700">{c.label}</p>
            <div className="flex flex-wrap gap-2">{items.filter((i) => placements[i.id] === c.id).map(chip)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FileAnswer({ value, onChange, disabled, prefix }: { value: Answer; onChange: (v: Answer) => void; disabled?: boolean; prefix?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {value.name ? <p className="text-sm">Attached: <strong>{String(value.name)}</strong></p> : null}
      <input type="file" disabled={disabled || busy || !prefix} onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f || !prefix) return;
        if (f.size > 50 * 1024 * 1024) { setErr("Files must be under 50 MB."); return; }
        setBusy(true); setErr(null);
        const path = `${prefix}/${crypto.randomUUID()}-${f.name.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
        const { error } = await createClient().storage.from("submissions").upload(path, f);
        setBusy(false);
        if (error) setErr(error.message); else onChange({ path, name: f.name, bytes: f.size });
      }} />
      {busy && <p className="text-xs text-ink-500">Uploading…</p>}
      {err && <p className="text-xs text-rose-600">{err}</p>}
    </div>
  );
}
