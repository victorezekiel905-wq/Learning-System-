"use client";
import { useState } from "react";
import { Check, CornerUpLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLoader } from "@/lib/hooks";
import { errorText, rpc } from "@/lib/rpc";
import { Badge, Button, Card, Empty, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { cn, timeAgo } from "@/lib/utils";

type Submission = {
  id: string; student: string; class: string; prompt: string; options: { label: string; correct: boolean }[];
  explanation: string; status: "pending" | "approved" | "returned"; feedback: string | null; created_at: string;
};
type Collab = { id: string; class_id: string; is_open: boolean; prompt: string | null };

/**
 * Students write questions for this quiz (the "create" level of Bloom's
 * taxonomy): the teacher opens it to a class, reviews each question and adds
 * the good ones, or sends them back with a note. Approved authors get XP, a
 * badge and a credit on the question.
 */
export function StudentQuestions({ activityId, onAdded }: { activityId: string; onAdded: () => void }) {
  const toast = useToast();
  const classes = useLoader(async () => {
    const { data } = await createClient().from("classes").select("id,name").is("archived_at", null).order("name");
    return (data ?? []) as { id: string; name: string }[];
  }, []);
  const collabs = useLoader(async () => {
    const { data } = await createClient().from("question_collabs").select("id,class_id,is_open,prompt").eq("activity_id", activityId);
    return (data ?? []) as Collab[];
  }, [activityId]);
  const subs = useLoader(() => rpc<Submission[]>("collab_submissions", { p_activity: activityId }), [activityId]);
  const [classId, setClassId] = useState("");
  const [ask, setAsk] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const open = (collabs.data ?? []).filter((c) => c.is_open);
  const nameOf = (id: string) => classes.data?.find((c) => c.id === id)?.name ?? "a class";
  const pending = (subs.data ?? []).filter((s) => s.status === "pending").length;

  async function setOpen(cls: string, on: boolean, prompt?: string) {
    try {
      await rpc("open_question_collab", { p_class: cls, p_activity: activityId, p_open: on, p_prompt: prompt ?? null });
      toast(on ? "Students have been told they can write questions." : "Question writing closed.", "success");
      setAsk("");
      void collabs.reload();
    } catch (e) { toast(errorText(e), "error"); }
  }

  async function review(id: string, action: "approve" | "return") {
    setBusy(id);
    try {
      await rpc("review_question_submission", { p_submission: id, p_action: action, p_feedback: notes[id] ?? null });
      toast(action === "approve" ? "Added to the quiz. The student earned 25 XP." : "Sent back with your note.", "success");
      void subs.reload();
      if (action === "approve") onAdded();
    } catch (e) { toast(errorText(e), "error"); }
    setBusy(null);
  }

  return (
    <Card title={<span className="flex items-center gap-2">Student-written questions {pending > 0 && <Badge tone="cyan">{pending} to review</Badge>}</span>}>
      <p className="mb-4 text-sm text-ink-600">
        Writing a good question, with a right answer and plausible wrong ones, takes real understanding. Open this quiz to a class and
        students send you questions with an explanation. You decide what goes in.
      </p>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-end">
        <Field label="Class"><Select value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">Choose a class…</option>
          {(classes.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select></Field>
        <Field label="What should questions be about? (optional)"><Input value={ask} maxLength={500} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. Comparing fractions with different denominators" /></Field>
        <Button disabled={!classId} onClick={() => setOpen(classId, true, ask)}><Icon name="write" className="h-4 w-4" />Open to class</Button>
      </div>
      {open.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {open.map((c) => (
            <li key={c.id} className="flex items-center gap-2 rounded-full border border-ink-200 bg-ink-50 py-1 pl-3 pr-1 text-[13px]">
              <span className="font-semibold">Open to {nameOf(c.class_id)}</span>
              <button className="rounded-full px-2 py-0.5 font-semibold text-rose-700 hover:bg-rose-50" onClick={() => setOpen(c.class_id, false)}>Close</button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-6">
        {(subs.data ?? []).length === 0 ? (
          <Empty title="No questions from students yet" icon={<Icon name="idea" />}>Questions appear here as students send them.</Empty>
        ) : (
          <ul className="space-y-3">
            {(subs.data ?? []).map((s) => (
              <li key={s.id} className={cn("rounded-xl border p-4", s.status === "pending" ? "border-ink-300 bg-white" : "border-ink-200 bg-ink-50/60")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] text-ink-500"><span className="font-semibold text-ink-800">{s.student}</span> · {s.class} · {timeAgo(s.created_at)}</p>
                  <Badge tone={s.status === "approved" ? "green" : s.status === "returned" ? "amber" : "gray"}>
                    {s.status === "approved" ? "Added" : s.status === "returned" ? "Sent back" : "Waiting"}
                  </Badge>
                </div>
                <p className="mt-2 font-semibold text-ink-900">{s.prompt}</p>
                <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                  {s.options.map((o, i) => (
                    <li key={i} className={cn("flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm", o.correct ? "border-emerald-300 bg-emerald-50 font-semibold text-emerald-900" : "border-ink-200 bg-white")}>
                      {o.correct && <Check className="h-4 w-4" aria-label="Correct answer" />}{o.label}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-sm text-ink-700"><span className="font-semibold">Why:</span> {s.explanation}</p>
                {s.feedback && <p className="mt-1 text-sm text-ink-600"><span className="font-semibold">Your note:</span> {s.feedback}</p>}
                {s.status !== "approved" && (
                  <div className="mt-3 flex flex-wrap items-end gap-2">
                    <Textarea rows={1} className="min-h-0 flex-1 basis-60" aria-label={`Note to ${s.student}`} placeholder="Note to the student (needed to send it back)"
                      value={notes[s.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [s.id]: e.target.value }))} />
                    <Button size="sm" variant="secondary" loading={busy === s.id} onClick={() => review(s.id, "return")}><CornerUpLeft className="h-3.5 w-3.5" aria-hidden />Send back</Button>
                    <Button size="sm" loading={busy === s.id} onClick={() => review(s.id, "approve")}><Check className="h-3.5 w-3.5" aria-hidden />Add to quiz</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
