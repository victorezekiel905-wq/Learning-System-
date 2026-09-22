"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Item, QuestionKind } from "@/lib/types";
import { uid } from "@/lib/utils";
import { Badge, Button, Field, Input, Select, Textarea, Toggle, useToast } from "@/components/ui";

export type EditableOption = { id?: string; label: string; is_correct: boolean; feedback?: string | null };
export type EditableQuestion = {
  id?: string;
  kind: QuestionKind;
  prompt: string;
  points: number;
  explanation: string | null;
  config: Record<string, unknown>;
  answer_key: Record<string, unknown>;
  options: EditableOption[];
  tags: string[];
  difficulty: number | null;
  in_bank: boolean;
  position: number;
};

export const KIND_LABEL: Record<QuestionKind, string> = {
  mcq: "Multiple choice", multi_select: "Select all that apply", true_false: "True / false", poll: "Poll",
  open: "Open-ended", short: "Short answer (rubric)", fill_blank: "Fill in the blanks", matching: "Matching pairs",
  ordering: "Put in order (drag)", categorize: "Sort into groups (drag)", draw: "Draw / annotate", file: "File upload", code: "Code"
};

export function blankQuestion(kind: QuestionKind, position = 0): EditableQuestion {
  const base: EditableQuestion = { kind, prompt: "", points: kind === "poll" ? 0 : 1, explanation: null, config: {}, answer_key: {}, options: [], tags: [], difficulty: null, in_bank: false, position };
  if (kind === "mcq" || kind === "multi_select") base.options = [{ label: "", is_correct: true }, { label: "", is_correct: false }, { label: "", is_correct: false }];
  if (kind === "poll") base.options = [{ label: "", is_correct: false }, { label: "", is_correct: false }];
  if (kind === "true_false") base.options = [{ label: "True", is_correct: true }, { label: "False", is_correct: false }];
  if (kind === "matching") { base.config = { left: [{ id: "l1", label: "" }, { id: "l2", label: "" }], right: [{ id: "r1", label: "" }, { id: "r2", label: "" }] }; base.answer_key = { pairs: { l1: "r1", l2: "r2" } }; }
  if (kind === "ordering") { base.config = { items: [{ id: uid(), label: "" }, { id: uid(), label: "" }, { id: uid(), label: "" }] }; }
  if (kind === "categorize") { base.config = { categories: [{ id: "c1", label: "" }, { id: "c2", label: "" }], items: [] }; base.answer_key = { placements: {} }; }
  if (kind === "code") { base.config = { language: "javascript", starter: "", tests: [] }; base.points = 5; }
  if (kind === "open" || kind === "short") base.points = kind === "short" ? 5 : 1;
  return base;
}

/** Persist a question and diff its options so existing answers keep valid option ids. */
export async function saveQuestion(q: EditableQuestion, ctx: { tenantId: string; ownerId: string; activityId: string | null }): Promise<string> {
  const sb = createClient();
  let config = q.config, key = q.answer_key;
  if (q.kind === "ordering") {
    const items = (q.config.items as Item[]) ?? [];
    key = { order: items.map((i) => i.id) };
  }
  if (q.kind === "fill_blank") {
    const blanks = (q.answer_key.blanks as string[][] | undefined) ?? [];
    config = { ...config, blanks: (q.prompt.match(/_{3,}/g) ?? []).length || blanks.length };
  }
  const row = {
    tenant_id: ctx.tenantId, owner_id: ctx.ownerId, activity_id: ctx.activityId, kind: q.kind, prompt: q.prompt.trim(),
    points: q.points, explanation: q.explanation || null, config, answer_key: key, tags: q.tags, difficulty: q.difficulty,
    in_bank: q.in_bank, position: q.position
  };
  const { data, error } = q.id
    ? await sb.from("questions").update(row).eq("id", q.id).select("id").single()
    : await sb.from("questions").insert(row).select("id").single();
  if (error) throw new Error(error.message);
  const qid = (data as { id: string }).id;

  if (["mcq", "multi_select", "true_false", "poll"].includes(q.kind)) {
    const { data: existing } = await sb.from("question_options").select("id").eq("question_id", qid);
    const keep = new Set(q.options.filter((o) => o.id).map((o) => o.id));
    const drop = (existing ?? []).map((o) => o.id as string).filter((id) => !keep.has(id));
    if (drop.length) await sb.from("question_options").delete().in("id", drop);
    for (const [i, o] of q.options.entries()) {
      const payload = { label: o.label.trim() || `Option ${i + 1}`, is_correct: q.kind === "poll" ? false : o.is_correct, feedback: o.feedback ?? null, position: i };
      const res = o.id
        ? await sb.from("question_options").update(payload).eq("id", o.id)
        : await sb.from("question_options").insert({ ...payload, tenant_id: ctx.tenantId, question_id: qid });
      if (res.error) throw new Error(res.error.message);
    }
  }
  return qid;
}

export function validateQuestion(q: EditableQuestion): string | null {
  if (!q.prompt.trim()) return "Write the question prompt.";
  if (["mcq", "true_false"].includes(q.kind) && q.options.filter((o) => o.is_correct).length !== 1) return "Mark exactly one correct option.";
  if (q.kind === "multi_select" && !q.options.some((o) => o.is_correct)) return "Mark at least one correct option.";
  if (["mcq", "multi_select", "poll"].includes(q.kind) && q.options.filter((o) => o.label.trim()).length < 2) return "Add at least two options.";
  if (q.kind === "fill_blank" && !/_{3,}/.test(q.prompt)) return "Use ___ (three underscores) in the prompt to mark each blank.";
  return null;
}

export function QuestionEditor({ value, onChange, onSave, onDelete, saving }: {
  value: EditableQuestion; onChange: (q: EditableQuestion) => void; onSave: () => void; onDelete?: () => void; saving?: boolean;
}) {
  const q = value;
  const set = (patch: Partial<EditableQuestion>) => onChange({ ...q, ...patch });
  const setConfig = (patch: Record<string, unknown>) => set({ config: { ...q.config, ...patch } });
  const toast = useToast();
  const [tagText, setTagText] = useState(q.tags.join(", "));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><Badge tone="brand">{KIND_LABEL[q.kind]}</Badge>{!q.id && <Badge tone="amber">Unsaved</Badge>}</div>
      <Field label="Prompt" hint={q.kind === "fill_blank" ? "Mark each blank with ___ (three underscores)." : "Supports **bold**, *italic*, `code`, lists and links."}>
        <Textarea rows={3} value={q.prompt} onChange={(e) => set({ prompt: e.target.value })} />
      </Field>

      {["mcq", "multi_select", "poll"].includes(q.kind) && (
        <div className="space-y-2">
          <p className="label">Options</p>
          {q.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              {q.kind !== "poll" && (
                <input type={q.kind === "mcq" ? "radio" : "checkbox"} name={`correct-${q.id ?? "new"}`} checked={o.is_correct} aria-label="Correct answer"
                  onChange={(e) => set({ options: q.options.map((x, j) => q.kind === "mcq" ? { ...x, is_correct: j === i } : j === i ? { ...x, is_correct: e.target.checked } : x) })} />
              )}
              <Input value={o.label} placeholder={`Option ${i + 1}`} onChange={(e) => set({ options: q.options.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
              <Button size="sm" variant="ghost" disabled={q.options.length <= 2} onClick={() => set({ options: q.options.filter((_, j) => j !== i) })} aria-label="Remove option">✕</Button>
            </div>
          ))}
          {q.options.length < 8 && <Button size="sm" variant="secondary" onClick={() => set({ options: [...q.options, { label: "", is_correct: false }] })}>Add option</Button>}
          {q.kind === "multi_select" && <Toggle checked={Boolean(q.config.partial_credit)} onChange={(v) => setConfig({ partial_credit: v })} label="Partial credit" description="Right choices minus wrong choices, as a share of the points." />}
        </div>
      )}

      {q.kind === "true_false" && (
        <Field label="Correct answer">
          <Select value={q.options[0]?.is_correct ? "true" : "false"} onChange={(e) => set({ options: [{ ...q.options[0]!, is_correct: e.target.value === "true" }, { ...q.options[1]!, is_correct: e.target.value === "false" }] })}>
            <option value="true">True</option><option value="false">False</option>
          </Select>
        </Field>
      )}

      {q.kind === "fill_blank" && (() => {
        const n = (q.prompt.match(/_{3,}/g) ?? []).length;
        const blanks = (q.answer_key.blanks as string[][] | undefined) ?? [];
        return (
          <div className="space-y-2">
            {Array.from({ length: n }).map((_, i) => (
              <Field key={i} label={`Blank ${i + 1}: accepted answers`} hint="Separate alternatives with |">
                <Input value={(blanks[i] ?? []).join(" | ")} onChange={(e) => {
                  const next = [...blanks]; next[i] = e.target.value.split("|").map((s) => s.trim()).filter(Boolean);
                  set({ answer_key: { ...q.answer_key, blanks: next.slice(0, n) } });
                }} />
              </Field>
            ))}
            <Toggle checked={Boolean(q.config.case_sensitive)} onChange={(v) => setConfig({ case_sensitive: v })} label="Case sensitive" />
          </div>
        );
      })()}

      {q.kind === "matching" && (() => {
        const left = (q.config.left as Item[]) ?? [], right = (q.config.right as Item[]) ?? [];
        return (
          <div className="space-y-2">
            <p className="label">Pairs (students see the right column shuffled)</p>
            {left.map((l, i) => (
              <div key={l.id} className="flex items-center gap-2">
                <Input value={l.label} placeholder="Term" onChange={(e) => setConfig({ left: left.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
                <span>↔</span>
                <Input value={right[i]?.label ?? ""} placeholder="Match" onChange={(e) => setConfig({ right: right.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
                <Button size="sm" variant="ghost" disabled={left.length <= 2} onClick={() => {
                  const nl = left.filter((_, j) => j !== i), nr = right.filter((_, j) => j !== i);
                  onChange({ ...q, config: { ...q.config, left: nl, right: nr }, answer_key: { pairs: Object.fromEntries(nl.map((x, j) => [x.id, nr[j]!.id])) } });
                }}>✕</Button>
              </div>
            ))}
            <Button size="sm" variant="secondary" onClick={() => {
              const id = uid();
              const nl = [...left, { id: `l${id}`, label: "" }], nr = [...right, { id: `r${id}`, label: "" }];
              onChange({ ...q, config: { ...q.config, left: nl, right: nr }, answer_key: { pairs: Object.fromEntries(nl.map((x, j) => [x.id, nr[j]!.id])) } });
            }}>Add pair</Button>
          </div>
        );
      })()}

      {q.kind === "ordering" && (() => {
        const items = (q.config.items as Item[]) ?? [];
        return (
          <div className="space-y-2">
            <p className="label">Items in the correct order (students get them shuffled)</p>
            {items.map((it, i) => (
              <div key={it.id} className="flex items-center gap-2">
                <span className="w-6 text-center text-sm font-bold text-ink-400">{i + 1}</span>
                <Input value={it.label} onChange={(e) => setConfig({ items: items.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
                <Button size="sm" variant="ghost" disabled={items.length <= 2} onClick={() => setConfig({ items: items.filter((_, j) => j !== i) })}>✕</Button>
              </div>
            ))}
            <Button size="sm" variant="secondary" onClick={() => setConfig({ items: [...items, { id: uid(), label: "" }] })}>Add item</Button>
          </div>
        );
      })()}

      {q.kind === "categorize" && (() => {
        const cats = (q.config.categories as Item[]) ?? [], items = (q.config.items as Item[]) ?? [];
        const placements = (q.answer_key.placements as Record<string, string>) ?? {};
        return (
          <div className="space-y-3">
            <p className="label">Groups</p>
            <div className="flex flex-wrap gap-2">
              {cats.map((c, i) => <Input key={c.id} className="w-40" value={c.label} placeholder={`Group ${i + 1}`} onChange={(e) => setConfig({ categories: cats.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />)}
              <Button size="sm" variant="secondary" onClick={() => setConfig({ categories: [...cats, { id: `c${uid()}`, label: "" }] })}>Add group</Button>
            </div>
            <p className="label">Items and where they belong</p>
            {items.map((it, i) => (
              <div key={it.id} className="flex items-center gap-2">
                <Input value={it.label} onChange={(e) => setConfig({ items: items.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} />
                <Select className="w-44" value={placements[it.id] ?? ""} onChange={(e) => set({ answer_key: { placements: { ...placements, [it.id]: e.target.value } } })}>
                  <option value="">Choose group</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.label || c.id}</option>)}
                </Select>
                <Button size="sm" variant="ghost" onClick={() => { const p = { ...placements }; delete p[it.id]; onChange({ ...q, config: { ...q.config, items: items.filter((_, j) => j !== i) }, answer_key: { placements: p } }); }}>✕</Button>
              </div>
            ))}
            <Button size="sm" variant="secondary" onClick={() => setConfig({ items: [...items, { id: uid(), label: "" }] })}>Add item</Button>
          </div>
        );
      })()}

      {(q.kind === "open" || q.kind === "short") && (
        <Field label="Max characters"><Input type="number" min={50} max={20000} value={Number(q.config.max_chars ?? (q.kind === "short" ? 1000 : 5000))} onChange={(e) => setConfig({ max_chars: Number(e.target.value) })} /></Field>
      )}

      {q.kind === "code" && (() => {
        const tests = (q.config.tests as { name: string; input: string; expected: string }[]) ?? [];
        return (
          <div className="space-y-3">
            <Field label="Language"><Select value={String(q.config.language ?? "javascript")} onChange={(e) => setConfig({ language: e.target.value })}>
              <option value="javascript">JavaScript</option><option value="python">Python</option><option value="html">HTML / CSS</option>
            </Select></Field>
            <Field label="Starter code"><Textarea rows={5} className="font-mono text-xs" value={String(q.config.starter ?? "")} onChange={(e) => setConfig({ starter: e.target.value })} /></Field>
            {q.config.language === "javascript" && (
              <div className="space-y-2">
                <p className="label">Self-check tests (students can see these; the final mark is yours)</p>
                {tests.map((t, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2">
                    <Input placeholder="Name" value={t.name} onChange={(e) => setConfig({ tests: tests.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
                    <Input placeholder="Expression, e.g. add(2,3)" className="font-mono text-xs" value={t.input} onChange={(e) => setConfig({ tests: tests.map((x, j) => j === i ? { ...x, input: e.target.value } : x) })} />
                    <Input placeholder="Expected, e.g. 5" className="font-mono text-xs" value={t.expected} onChange={(e) => setConfig({ tests: tests.map((x, j) => j === i ? { ...x, expected: e.target.value } : x) })} />
                    <Button size="sm" variant="ghost" onClick={() => setConfig({ tests: tests.filter((_, j) => j !== i) })}>✕</Button>
                  </div>
                ))}
                <Button size="sm" variant="secondary" onClick={() => setConfig({ tests: [...tests, { name: `Test ${tests.length + 1}`, input: "", expected: "" }] })}>Add test</Button>
              </div>
            )}
          </div>
        );
      })()}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Points"><Input type="number" min={0} max={1000} step="0.5" value={q.points} onChange={(e) => set({ points: Number(e.target.value) })} /></Field>
        <Field label="Difficulty"><Select value={q.difficulty ?? ""} onChange={(e) => set({ difficulty: e.target.value ? Number(e.target.value) : null })}>
          <option value="">—</option>{[1, 2, 3, 4, 5].map((d) => <option key={d} value={d}>{d}</option>)}
        </Select></Field>
        <Field label="Tags"><Input value={tagText} onChange={(e) => setTagText(e.target.value)} onBlur={() => set({ tags: tagText.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 10) })} placeholder="html, week 2" /></Field>
      </div>
      <Field label="Explanation shown after answering (optional)"><Textarea rows={2} value={q.explanation ?? ""} onChange={(e) => set({ explanation: e.target.value })} /></Field>
      <Toggle checked={q.in_bank} onChange={(v) => set({ in_bank: v })} label="Share in the school question bank" description="Other teachers in your school can reuse it." />

      <div className="flex justify-between">
        {onDelete ? <Button variant="ghost" className="text-rose-600" onClick={onDelete}>Delete question</Button> : <span />}
        <Button loading={saving} onClick={() => { const err = validateQuestion(q); if (err) toast(err, "error"); else onSave(); }}>Save question</Button>
      </div>
    </div>
  );
}
