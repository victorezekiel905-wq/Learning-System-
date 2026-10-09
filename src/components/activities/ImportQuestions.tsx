"use client";
import { useMemo, useRef, useState } from "react";
import type { QuestionKind } from "@/lib/types";
import { IMPORT_KIND_NAME, importExample, parseQuestions, questionsToText, type ImportedQuestion } from "@/lib/question-import";
import { readQuestionFile } from "@/lib/question-file";
import { Alert, Badge, Button, Modal, Textarea } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";
import type { EditableQuestion } from "./QuestionEditor";

const TEMPLATE = [
  "Question,Option A,Option B,Option C,Option D,Answer,Topic,Points,Explanation",
  "What is the capital of Nigeria?,Lagos,Abuja,Kano,Ibadan,B,Geography,1,Abuja became the capital in 1991.",
  "Which of these are prime numbers?,2,4,7,9,\"A, C\",Numbers,2,",
  "Water boils at 100 °C at sea level.,True,False,,,A,Science,1,"
].join("\r\n");

/**
 * Paste questions or choose a file (Word, Excel, CSV, text); they are numbered,
 * their options lettered and answers read, with a preview before anything is saved.
 */
export function ImportQuestions({ allowed, startAt, onClose, onImport }: {
  allowed: QuestionKind[]; startAt: number; onClose: () => void; onImport: (qs: EditableQuestion[]) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [note, setNote] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => (text.trim() ? parseQuestions(text, allowed) : []), [text, allowed]);
  const ready = parsed.filter((q) => !q.problem);
  const broken = parsed.length - ready.length;
  const example = importExample(allowed);

  async function choose(file?: File) {
    if (!file) return;
    setNote(null);
    const r = await readQuestionFile(file);
    if (fileRef.current) fileRef.current.value = "";
    if (r.error) { setNote({ tone: "error", text: r.error }); return; }
    // A Word file is shown tidied up: numbered, options lettered, and answers marked in bold
    // or colour written as "Answer:" lines. Questions that need a fix keep their own lines.
    const t = r.paragraphs ? questionsToText(parseQuestions(r.text, allowed, { paragraphs: true })) : r.text.trim();
    if (!t.trim()) { setNote({ tone: "error", text: `No questions found in ${file.name}.` }); return; }
    setText(t);
    setNote({ tone: "success", text: `Read ${file.name}. Check the preview, fix anything marked, then add them.` });
  }

  async function add() {
    setBusy(true);
    try {
      await onImport(ready.map((q, i) => ({
        kind: q.kind, prompt: q.prompt, points: q.points, explanation: q.explanation, topic: q.topic, config: q.config, answer_key: q.answer_key,
        options: q.options.map((o) => ({ label: o.label, is_correct: o.is_correct })), tags: [], difficulty: null, bloom_level: null, in_bank: false, position: startAt + i
      })));
    } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} wide title="Import questions"
      footer={<>
        <span className="mr-auto self-center text-[13px] text-ink-600">
          {parsed.length ? <><b className="text-ink-900">{ready.length} ready</b>{broken ? <span className="text-rose-700"> · {broken} need a fix and won&apos;t be added</span> : null}</> : null}
        </span>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button loading={busy} disabled={!ready.length} onClick={add}>{ready.length ? `Add ${ready.length} question${ready.length === 1 ? "" : "s"}` : "Add questions"}</Button>
      </>}>
      <div className="grid gap-5 md:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" className="sr-only" id="question-file" onChange={(e) => void choose(e.target.files?.[0])}
              accept=".docx,.xlsx,.csv,.txt,.md,text/plain,text/csv,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" />
            <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}><Icon name="upload" className="h-4 w-4" />Choose a file</Button>
            <span className="text-[12px] text-ink-500">Word, Excel, CSV or text</span>
            <button type="button" className="ml-auto text-[13px] font-semibold text-brand-700" onClick={() => saveFile("questions-template.csv", TEMPLATE)}>Excel template</button>
          </div>
          {note && <Alert tone={note.tone}>{note.text}</Alert>}
          <Textarea rows={16} value={text} onChange={(e) => setText(e.target.value)} aria-label="Questions" className="font-mono text-[13px] leading-relaxed"
            placeholder={`Paste or type your questions, for example:\n\n${example}`} />
          <details className="rounded-xl bg-ink-50 px-4 py-3 text-[13px] text-ink-700">
            <summary className="cursor-pointer font-semibold text-ink-900">How to write them</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Start each question with its number (<code>1.</code>, <code>Q1</code>) or leave a blank line between questions. Numbers are redone in order.</li>
              <li>Put each option on its own line: <code>A.</code> <code>B.</code> <code>C.</code>… or several on one line (<code>A. 2   B. 4</code>).</li>
              <li>Show the right answer with <code>Answer: B</code> (or <code>Answer: A, C</code> for more than one), or put <code>*</code> after it. In Word, making the right option <b>bold</b>, underlined, highlighted or coloured works too.</li>
              <li>Optional lines: <code>Topic:</code>, <code>Points:</code>, <code>Explanation:</code>. Other kinds use <code>Type:</code> (Matching, Order, Groups, Poll).</li>
              <li>From a PDF: select the questions, copy, and paste them here.</li>
            </ul>
            <Button size="sm" variant="secondary" className="mt-3" onClick={() => setText(example)}>Use the example</Button>
          </details>
        </div>

        <div className="min-w-0">
          <p className="mb-2 text-[13px] font-semibold text-ink-900">Preview</p>
          {!parsed.length ? (
            <div className="grid h-[22rem] place-items-center rounded-xl border border-dashed border-ink-200 px-6 text-center text-sm text-ink-500">
              Questions appear here as you paste them, numbered, with the right answers marked.
            </div>
          ) : (
            <ol className="max-h-[30rem] space-y-3 overflow-y-auto pr-1">
              {parsed.map((q, i) => <PreviewItem key={i} n={i + 1} q={q} />)}
            </ol>
          )}
        </div>
      </div>
    </Modal>
  );
}

function PreviewItem({ n, q }: { n: number; q: ImportedQuestion }) {
  const letter = (i: number) => String.fromCharCode(65 + i);
  return (
    <li className={cn("rounded-xl border p-3", q.problem ? "border-rose-300 bg-rose-50/50" : "border-ink-200 bg-white")}>
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-ink-900 text-[12px] font-bold text-white">{n}</span>
        <Badge tone="brand">{IMPORT_KIND_NAME[q.kind]}</Badge>
        {q.kind !== "poll" && <span className="text-[12px] text-ink-500">{q.points} pt</span>}
        {q.topic && <span className="truncate text-[12px] text-ink-500">· {q.topic}</span>}
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm text-ink-900">{q.prompt || <em className="text-ink-500">No question</em>}</p>
      {q.options.length > 0 && (
        <ul className="mt-2 space-y-1">
          {q.options.map((o, i) => (
            <li key={i} className={cn("flex items-start gap-2 rounded-lg px-2 py-1 text-[13px]", o.is_correct ? "bg-emerald-50 text-emerald-900" : "text-ink-700")}>
              <span className="font-semibold">{letter(i)}</span><span className="min-w-0 flex-1">{o.label}</span>
              {o.is_correct && <Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            </li>
          ))}
        </ul>
      )}
      {q.kind === "fill_blank" && !q.problem && (
        <p className="mt-2 text-[13px] text-emerald-800">Answer: {((q.answer_key.blanks as string[][]) ?? []).map((b) => b.join(" or ")).join("; ")}</p>
      )}
      {q.kind === "matching" && !q.problem && (
        <ul className="mt-2 space-y-1 text-[13px] text-ink-700">
          {((q.config.left as { label: string }[]) ?? []).map((l, i) => <li key={i}>{l.label} <span className="text-ink-400">↔</span> {(q.config.right as { label: string }[])[i]?.label}</li>)}
        </ul>
      )}
      {q.kind === "ordering" && !q.problem && (
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-[13px] text-ink-700">{((q.config.items as { label: string }[]) ?? []).map((it, i) => <li key={i}>{it.label}</li>)}</ol>
      )}
      {q.kind === "categorize" && !q.problem && (
        <ul className="mt-2 space-y-0.5 text-[13px] text-ink-700">
          {((q.config.categories as { id: string; label: string }[]) ?? []).map((c) => (
            <li key={c.id}><b>{c.label}:</b> {((q.config.items as { id: string; label: string }[]) ?? []).filter((it) => (q.answer_key.placements as Record<string, string>)[it.id] === c.id).map((it) => it.label).join(", ")}</li>
          ))}
        </ul>
      )}
      {q.problem && <p className="mt-2 text-[13px] font-medium text-rose-700">{q.problem}</p>}
    </li>
  );
}

function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["\ufeff" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
