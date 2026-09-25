"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLoader } from "@/lib/hooks";
import { errorText, rpc } from "@/lib/rpc";
import type { ActivityKind, ActivitySettings, PublicQuestion, QuestionKind } from "@/lib/types";
import { Alert, Badge, Button, Card, Field, Input, Modal, Select, Textarea, Toggle, useToast } from "@/components/ui";
import { blankQuestion, KIND_LABEL, QuestionEditor, saveQuestion, type EditableOption, type EditableQuestion } from "./QuestionEditor";
import { Prompt, QuestionInput } from "./QuestionInput";

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  multiple_choice: "Multiple choice", poll: "Poll", open_ended: "Open-ended response", quiz: "Quiz (multiple questions)",
  draw: "Draw / annotate", fill_blank: "Fill in the blanks", matching: "Matching pairs", drag_drop: "Drag and drop",
  collab_board: "Collaborative board", file_upload: "File submission", short_answer: "Short answer (rubric)", code: "Coding activity"
};

export const KINDS_FOR: Record<ActivityKind, QuestionKind[]> = {
  multiple_choice: ["mcq", "multi_select", "true_false"],
  poll: ["poll"],
  open_ended: ["open"],
  quiz: ["mcq", "multi_select", "true_false", "fill_blank", "matching", "ordering", "categorize", "short", "open", "draw", "code", "file"],
  draw: ["draw"],
  fill_blank: ["fill_blank"],
  matching: ["matching"],
  drag_drop: ["ordering", "categorize"],
  collab_board: [],
  file_upload: ["file"],
  short_answer: ["short"],
  code: ["code"]
};

export type Activity = { id: string; kind: ActivityKind; title: string; instructions: string | null; settings: ActivitySettings; lesson_id: string | null; tenant_id: string; owner_id: string };

function toEditable(row: Record<string, unknown>): EditableQuestion {
  return {
    id: row.id as string, kind: row.kind as QuestionKind, prompt: row.prompt as string, points: Number(row.points),
    explanation: (row.explanation as string) ?? null, config: (row.config as Record<string, unknown>) ?? {},
    answer_key: (row.answer_key as Record<string, unknown>) ?? {}, tags: (row.tags as string[]) ?? [],
    difficulty: (row.difficulty as number) ?? null, bloom_level: (row.bloom_level as string) ?? null,
    in_bank: Boolean(row.in_bank), position: Number(row.position ?? 0),
    options: ((row.question_options as (EditableOption & { position: number })[]) ?? [])
      .sort((a, b) => a.position - b.position)
      .map((o) => ({ id: o.id, label: o.label, is_correct: o.is_correct, feedback: o.feedback }))
  };
}

export function ActivityEditor({ activity, onChanged, rubrics }: { activity: Activity; onChanged?: () => void; rubrics?: { id: string; title: string }[] }) {
  const toast = useToast();
  const [meta, setMeta] = useState(activity);
  const [openQ, setOpenQ] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, EditableQuestion>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [bankOpen, setBankOpen] = useState(false);
  const [preview, setPreview] = useState(false);
  const allowed = KINDS_FOR[meta.kind];

  const questions = useLoader(async () => {
    const { data, error } = await createClient().from("questions")
      .select("id,kind,prompt,points,explanation,config,answer_key,tags,difficulty,bloom_level,in_bank,position,question_options(id,label,is_correct,feedback,position)")
      .eq("activity_id", activity.id).order("position").order("created_at");
    if (error) throw error;
    return (data ?? []).map((r) => toEditable(r as Record<string, unknown>));
  }, [activity.id]);

  async function saveMeta() {
    const { error } = await createClient().from("activities").update({ title: meta.title, instructions: meta.instructions, settings: meta.settings }).eq("id", activity.id);
    if (error) toast(error.message, "error"); else { toast("Activity saved", "success"); onChanged?.(); }
  }
  const setSettings = (patch: Partial<ActivitySettings>) => setMeta({ ...meta, settings: { ...meta.settings, ...patch } });

  async function save(key: string, q: EditableQuestion) {
    setSaving(key);
    try {
      await saveQuestion(q, { tenantId: activity.tenant_id, ownerId: activity.owner_id, activityId: activity.id });
      toast("Question saved", "success");
      setDraft((d) => { const n = { ...d }; delete n[key]; return n; });
      if (key.startsWith("new")) setOpenQ(null);
      await questions.reload();
    } catch (e) { toast(errorText(e), "error"); }
    setSaving(null);
  }
  async function remove(id: string) {
    if (!confirm("Delete this question? Students' answers to it are deleted too.")) return;
    const { error } = await createClient().from("questions").delete().eq("id", id);
    if (error) toast(error.message, "error"); else void questions.reload();
  }
  function addQuestion(kind: QuestionKind) {
    const key = `new-${Date.now()}`;
    setDraft((d) => ({ ...d, [key]: blankQuestion(kind, (questions.data ?? []).length) }));
    setOpenQ(key);
  }

  const list = questions.data ?? [];
  const newKeys = Object.keys(draft).filter((k) => k.startsWith("new"));

  return (
    <div className="space-y-5">
      <Card title={<span className="flex items-center gap-2">Activity <Badge tone="brand">{ACTIVITY_LABEL[meta.kind]}</Badge></span>}
        actions={<><Button size="sm" variant="secondary" onClick={() => setPreview(true)} disabled={!list.length}>Preview as student</Button><Button size="sm" onClick={saveMeta}>Save settings</Button></>}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Title"><Input value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} /></Field>
          <Field label="Feedback to students"><Select value={meta.settings.show_feedback ?? "after_submit"} onChange={(e) => setSettings({ show_feedback: e.target.value as ActivitySettings["show_feedback"] })}>
            <option value="immediately">Immediately after each answer</option><option value="after_submit">After submitting</option><option value="never">Never (teacher reviews)</option>
          </Select></Field>
          <Field label="Instructions" className="md:col-span-2"><Textarea rows={2} value={meta.instructions ?? ""} onChange={(e) => setMeta({ ...meta, instructions: e.target.value })} /></Field>
          <Field label="Time limit (seconds, 0 = none)"><Input type="number" min={0} max={14400} value={meta.settings.time_limit_seconds ?? 0} onChange={(e) => setSettings({ time_limit_seconds: Number(e.target.value) })} /></Field>
          <Field label="Attempts allowed (0 = unlimited)"><Input type="number" min={0} max={20} value={meta.settings.attempts_allowed ?? 1} onChange={(e) => setSettings({ attempts_allowed: Number(e.target.value) })} /></Field>
          <Toggle checked={Boolean(meta.settings.shuffle_questions)} onChange={(v) => setSettings({ shuffle_questions: v })} label="Randomise question order" description="Each attempt gets its own reproducible order." />
          <Toggle checked={Boolean(meta.settings.shuffle_options)} onChange={(v) => setSettings({ shuffle_options: v })} label="Shuffle answer options" />
          <Toggle checked={Boolean(meta.settings.differentiate)} onChange={(v) => setSettings({ differentiate: v })} label="Differentiate by challenge level" description="Each student gets the questions for their level (Support 1–3, Core 2–4, Extension 3–5 by difficulty). Set levels on the class page; students can choose their own if you allow it." />
          {rubrics && (meta.kind === "short_answer" || meta.kind === "quiz" || meta.kind === "open_ended") && (
            <Field label="Rubric for review"><Select value={meta.settings.rubric_id ?? ""} onChange={(e) => setSettings({ rubric_id: e.target.value || undefined })}>
              <option value="">None</option>{rubrics.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
            </Select></Field>
          )}
        </div>
      </Card>

      {meta.kind === "collab_board" ? (
        <Alert>A collaborative board is created for each live session when you open this activity. Students post ideas and you can lock the board or hide posts.</Alert>
      ) : (
        <Card title={`Questions (${list.length})`} actions={
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setBankOpen(true)}>From question bank</Button>
            {allowed.length === 1 ? <Button size="sm" onClick={() => addQuestion(allowed[0]!)}>Add question</Button> : (
              <Select aria-label="Add a question" className="w-auto py-1 text-xs" value="" onChange={(e) => e.target.value && addQuestion(e.target.value as QuestionKind)}>
                <option value="">+ Add question…</option>{allowed.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </Select>
            )}
          </div>}>
          {questions.error && <Alert tone="error">{questions.error}</Alert>}
          {!list.length && !newKeys.length && <p className="text-sm text-ink-500">No questions yet.</p>}
          <ul className="space-y-3">
            {list.map((q, i) => {
              const key = q.id!;
              const open = openQ === key;
              return (
                <li key={key} className="rounded-lg border border-ink-200">
                  <button className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left" onClick={() => setOpenQ(open ? null : key)} aria-expanded={open}>
                    <span className="truncate text-sm"><span className="mr-2 font-bold text-ink-500">{i + 1}</span>{q.prompt || <em>No prompt</em>}</span>
                    <span className="flex shrink-0 items-center gap-2"><Badge>{KIND_LABEL[q.kind]}</Badge><Badge tone="gray">{q.points} pt</Badge></span>
                  </button>
                  {open && <div className="border-t border-ink-100 p-4">
                    <QuestionEditor value={draft[key] ?? q} onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))} saving={saving === key}
                      onSave={() => save(key, draft[key] ?? q)} onDelete={() => remove(key)} />
                  </div>}
                </li>
              );
            })}
            {newKeys.map((key) => (
              <li key={key} className="rounded-lg border-2 border-dashed border-brand-300 p-4">
                <QuestionEditor value={draft[key]!} onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))} saving={saving === key}
                  onSave={() => save(key, draft[key]!)} onDelete={() => setDraft((d) => { const n = { ...d }; delete n[key]; return n; })} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {bankOpen && <BankPicker allowed={allowed} onClose={() => setBankOpen(false)} onPick={async (qs) => {
        for (const [i, q] of qs.entries()) {
          await saveQuestion({ ...q, id: undefined, in_bank: false, position: list.length + i, options: q.options.map((o) => ({ ...o, id: undefined })) },
            { tenantId: activity.tenant_id, ownerId: activity.owner_id, activityId: activity.id });
        }
        setBankOpen(false);
        toast(`Added ${qs.length} question(s)`, "success");
        void questions.reload();
      }} />}
      {preview && <PreviewModal activityId={activity.id} onClose={() => setPreview(false)} />}
    </div>
  );
}

function BankPicker({ allowed, onClose, onPick }: { allowed: QuestionKind[]; onClose: () => void; onPick: (q: EditableQuestion[]) => Promise<void> }) {
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const bank = useLoader(async () => {
    let q = createClient().from("questions")
      .select("id,kind,prompt,points,explanation,config,answer_key,tags,difficulty,bloom_level,in_bank,position,question_options(id,label,is_correct,feedback,position)")
      .or("in_bank.eq.true,activity_id.is.null").in("kind", allowed).order("created_at", { ascending: false }).limit(100);
    if (search.trim()) q = q.ilike("prompt", `%${search.trim().replace(/[%_]/g, "")}%`);
    const { data } = await q;
    return (data ?? []).map((r) => toEditable(r as Record<string, unknown>));
  }, [search]);
  const rows = bank.data ?? [];
  return (
    <Modal open onClose={onClose} wide title="Add from question bank"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!picked.size} onClick={async () => { setBusy(true); await onPick(rows.filter((r) => picked.has(r.id!))); setBusy(false); }}>Add {picked.size || ""}</Button></>}>
      <Input placeholder="Search prompts…" value={search} onChange={(e) => setSearch(e.target.value)} className="mb-3" />
      {!rows.length && <p className="text-sm text-ink-500">No matching bank questions. Tick "Share in the school question bank" on any question to add it here.</p>}
      <ul className="divide-y divide-ink-100">
        {rows.map((r) => (
          <li key={r.id}><label className="flex cursor-pointer items-start gap-3 py-2">
            <input type="checkbox" className="mt-1" checked={picked.has(r.id!)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(r.id!); else n.delete(r.id!); setPicked(n); }} />
            <span className="text-sm"><span className="block">{r.prompt}</span><span className="text-xs text-ink-500">{KIND_LABEL[r.kind]} · {r.tags.join(", ")}</span></span>
          </label></li>
        ))}
      </ul>
    </Modal>
  );
}

function PreviewModal({ activityId, onClose }: { activityId: string; onClose: () => void }) {
  const data = useLoader(() => rpc<{ questions: PublicQuestion[] }>("preview_activity", { p_activity: activityId }), [activityId]);
  const [answers, setAnswers] = useState<Record<string, Record<string, unknown>>>({});
  return (
    <Modal open onClose={onClose} wide title="Student preview (answers are not saved)">
      <div className="space-y-6">
        {(data.data?.questions ?? []).map((q, i) => (
          <div key={q.id} className="space-y-3 border-b border-ink-100 pb-5">
            <p className="text-xs font-semibold text-ink-500">Question {i + 1}</p>
            <Prompt q={q} />
            <QuestionInput q={q} value={answers[q.id]} onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))} />
          </div>
        ))}
      </div>
    </Modal>
  );
}
