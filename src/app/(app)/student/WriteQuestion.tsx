"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useLoader } from "@/lib/hooks";
import { errorText, rpc } from "@/lib/rpc";
import { Alert, Badge, Button, Field, Input, Modal, Textarea, useToast } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";

type Collab = {
  id: string; title: string; class: string; prompt: string | null;
  mine: { id: string; prompt: string; status: "pending" | "approved" | "returned"; feedback: string | null }[];
};

const STATUS = { pending: ["Waiting for your teacher", "gray"], approved: ["Added to the quiz", "green"], returned: ["Sent back: see the note", "amber"] } as const;

/** Quizzes a teacher has opened for question writing, and the student's own questions with feedback. */
export function WriteQuestion() {
  const collabs = useLoader(() => rpc<Collab[]>("my_collabs"), []);
  const [writing, setWriting] = useState<Collab | null>(null);
  const list = collabs.data ?? [];
  if (!list.length) return null;

  return (
    <section className="mb-6 rounded-2xl border border-ink-200 bg-white p-5 sm:p-6" aria-labelledby="write-q">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="write-q" className="flex items-center gap-2 font-display text-lg font-bold"><Icon name="write" className="h-5 w-5" />Write a question for your class</h2>
          <p className="mt-1 max-w-xl text-sm text-ink-600">Your teacher picks the best ones for the quiz. If yours goes in, your name is on it and you earn 25 XP.</p>
        </div>
      </div>
      <ul className="mt-4 space-y-3">
        {list.map((c) => (
          <li key={c.id} className="rounded-xl border border-ink-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-semibold text-ink-900">{c.title}</p>
                <p className="text-[13px] text-ink-500">{c.class}{c.prompt && ` · ${c.prompt}`}</p>
              </div>
              <Button size="sm" onClick={() => setWriting(c)}><Plus className="h-3.5 w-3.5" aria-hidden />Write a question</Button>
            </div>
            {c.mine.length > 0 && (
              <ul className="mt-3 space-y-2 border-t border-ink-100 pt-3">
                {c.mine.map((m) => (
                  <li key={m.id} className="text-sm">
                    <span className="flex flex-wrap items-center gap-2"><span className="min-w-0 flex-1 truncate">{m.prompt}</span><Badge tone={STATUS[m.status][1]}>{STATUS[m.status][0]}</Badge></span>
                    {m.feedback && <span className="mt-1 block text-[13px] text-ink-600">Teacher: {m.feedback}</span>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      {writing && <QuestionForm collab={writing} onClose={() => setWriting(null)} onSent={() => { setWriting(null); void collabs.reload(); }} />}
    </section>
  );
}

function QuestionForm({ collab, onClose, onSent }: { collab: Collab; onClose: () => void; onSent: () => void }) {
  const toast = useToast();
  const [prompt, setPrompt] = useState("");
  const [options, setOptions] = useState([{ label: "", correct: true }, { label: "", correct: false }, { label: "", correct: false }]);
  const [why, setWhy] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    setErr(null);
    const filled = options.filter((o) => o.label.trim());
    if (prompt.trim().length < 5) return setErr("Write your question first.");
    if (filled.length < 2) return setErr("Give at least two answer choices.");
    if (!filled.some((o) => o.correct)) return setErr("Mark which choice is correct.");
    setBusy(true);
    try {
      await rpc("submit_question", { p_collab: collab.id, p_prompt: prompt, p_options: filled, p_explanation: why });
      toast("Sent to your teacher.", "success");
      onSent();
    } catch (e) { setErr(errorText(e)); }
    setBusy(false);
  }

  return (
    <Modal open onClose={onClose} wide title={`Your question for ${collab.title}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={send}>Send to teacher</Button></>}>
      <div className="space-y-5">
        {collab.prompt && <Alert>Your teacher asked for: {collab.prompt}</Alert>}
        <Field label="Question"><Textarea rows={2} maxLength={1000} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ask something that makes people think, not just remember." /></Field>
        <fieldset>
          <legend className="label">Answer choices: tap the circle next to the correct one</legend>
          <ul className="space-y-2">
            {options.map((o, i) => (
              <li key={i} className="flex items-center gap-2">
                <input type="radio" name="correct" aria-label={`Choice ${i + 1} is correct`} checked={o.correct} className="h-5 w-5 shrink-0 accent-emerald-600"
                  onChange={() => setOptions(options.map((x, j) => ({ ...x, correct: j === i })))} />
                <Input aria-label={`Choice ${i + 1}`} maxLength={300} value={o.label} placeholder={o.correct ? "The correct answer" : "A believable wrong answer"}
                  className={cn(o.correct && "border-emerald-400")} onChange={(e) => setOptions(options.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                {options.length > 2 && (
                  <button type="button" className="btn btn-ghost h-10 w-10 shrink-0 px-0" aria-label={`Remove choice ${i + 1}`}
                    onClick={() => { const n = options.filter((_, j) => j !== i); if (!n.some((x) => x.correct)) n[0]!.correct = true; setOptions(n); }}>
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {options.length < 6 && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setOptions([...options, { label: "", correct: false }])}><Plus className="h-3.5 w-3.5" aria-hidden />Add a choice</Button>}
        </fieldset>
        <Field label="Why is the correct answer right?" hint="Your teacher reads this first. Show your thinking.">
          <Textarea rows={3} maxLength={1000} value={why} onChange={(e) => setWhy(e.target.value)} />
        </Field>
        {err && <Alert tone="error">{err}</Alert>}
      </div>
    </Modal>
  );
}
