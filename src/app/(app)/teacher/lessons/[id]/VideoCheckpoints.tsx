"use client";
import { useState } from "react";
import { blankQuestion, QuestionEditor, saveQuestion, type EditableQuestion } from "@/components/activities/QuestionEditor";
import { Alert, Button, Field, Input, Modal, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useLoader } from "@/lib/hooks";
import { errorText } from "@/lib/rpc";

type Checkpoint = { id: string; t_seconds: number; required: boolean; question_id: string; questions: { prompt: string } | null };

/**
 * Interactive video (§3.1): questions pinned to timestamps. Checkpoint
 * questions live in one hidden "Video checkpoints" quiz per lesson so they are
 * graded by the normal attempt engine.
 */
export function VideoCheckpoints({ slideId, lesson, userId, directVideo }: { slideId: string; lesson: { id: string; tenant_id: string }; userId: string; directVideo: boolean }) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [t, setT] = useState("0:30");
  const [q, setQ] = useState<EditableQuestion>(blankQuestion("mcq"));
  const [busy, setBusy] = useState(false);
  const list = useLoader(async () => {
    const { data } = await createClient().from("video_checkpoints").select("id,t_seconds,required,question_id,questions(prompt)").eq("slide_id", slideId).order("t_seconds");
    return (data ?? []) as unknown as Checkpoint[];
  }, [slideId]);

  async function holderActivity(): Promise<string> {
    const sb = createClient();
    const { data } = await sb.from("activities").select("id").eq("lesson_id", lesson.id).eq("title", "Video checkpoints").maybeSingle();
    if (data) return data.id;
    const { data: created, error } = await sb.from("activities").insert({
      tenant_id: lesson.tenant_id, lesson_id: lesson.id, owner_id: userId, kind: "quiz", title: "Video checkpoints",
      settings: { show_feedback: "immediately", attempts_allowed: 1 }
    }).select("id").single();
    if (error) throw new Error(error.message);
    return created.id;
  }

  function parseTime(s: string) {
    const parts = s.trim().split(":").map(Number);
    if (parts.some((n) => Number.isNaN(n))) return null;
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }

  async function add() {
    const secs = parseTime(t);
    if (secs === null) { toast("Use mm:ss for the time.", "error"); return; }
    setBusy(true);
    try {
      const activityId = await holderActivity();
      const qid = await saveQuestion(q, { tenantId: lesson.tenant_id, ownerId: userId, activityId });
      const { error } = await createClient().from("video_checkpoints").insert({ tenant_id: lesson.tenant_id, slide_id: slideId, question_id: qid, t_seconds: secs });
      if (error) throw new Error(error.message);
      setAdding(false);
      setQ(blankQuestion("mcq"));
      void list.reload();
    } catch (e) { toast(errorText(e), "error"); }
    setBusy(false);
  }

  return (
    <div className="space-y-2 rounded-lg border border-ink-200 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Checkpoint questions</p>
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>Add checkpoint</Button>
      </div>
      {!directVideo && (list.data ?? []).length > 0 && <Alert tone="warn">Checkpoints pause the video automatically only for uploaded or .mp4 videos. For YouTube/Vimeo they appear as a list students answer.</Alert>}
      {(list.data ?? []).length === 0 ? <p className="text-xs text-ink-500">The video pauses at each timestamp until the student answers.</p> : (
        <ul className="space-y-1 text-sm">
          {(list.data ?? []).map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <span><span className="font-mono text-xs text-brand-700">{Math.floor(c.t_seconds / 60)}:{String(Math.round(c.t_seconds % 60)).padStart(2, "0")}</span> {c.questions?.prompt}</span>
              <Button size="sm" variant="ghost" className="text-rose-600" onClick={async () => { await createClient().from("questions").delete().eq("id", c.question_id); void list.reload(); }}>✕</Button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="New checkpoint" wide>
        <div className="space-y-4">
          <Field label="Time (mm:ss)"><Input value={t} onChange={(e) => setT(e.target.value)} className="w-32 font-mono" /></Field>
          <QuestionEditor value={q} onChange={setQ} onSave={add} saving={busy} />
        </div>
      </Modal>
    </div>
  );
}
