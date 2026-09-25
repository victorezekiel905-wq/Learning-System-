"use client";
import { useState } from "react";
import { CodeRunner } from "@/components/activities/CodeRunner";
import { RichText } from "@/components/RichText";
import { StrokeLayer, BOARD_H, BOARD_W } from "@/components/slides/Whiteboard";
import { Badge, Button, Card, Empty, Field, Input, Textarea, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useRpc } from "@/lib/hooks";
import { errorText, rpc } from "@/lib/rpc";
import type { Stroke } from "@/lib/types";
import { timeAgo } from "@/lib/utils";
import { Icon } from "@/components/Icon";

type Item = {
  answer_id: string; answered_at: string; response: Record<string, unknown>; status: string;
  question: { id: string; kind: string; prompt: string; points: number; config: Record<string, unknown> };
  activity: { id: string; title: string; rubric_id: string | null };
  student: { id: string; name: string };
};
type Rubric = { id: string; title: string; criteria: { id: string; title: string; levels: { label: string; points: number }[] }[] };

export function ReviewQueue({ rubrics }: { rubrics: Rubric[] }) {
  const q = useRpc<Item[]>("review_queue", {}, []);
  const items = q.data ?? [];
  if (q.loading) return <p className="text-sm text-ink-500">Loading…</p>;
  if (!items.length) return <Empty title="Nothing to review">Everything is marked.</Empty>;
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">{items.length} answer(s) waiting</p>
      {items.map((it) => <ReviewCard key={it.answer_id} it={it} rubric={rubrics.find((r) => r.id === it.activity.rubric_id)} onDone={() => void q.reload()} />)}
    </div>
  );
}

function ReviewCard({ it, rubric, onDone }: { it: Item; rubric?: Rubric; onDone: () => void }) {
  const toast = useToast();
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [picks, setPicks] = useState<Record<string, number>>({});
  const max = rubric?.criteria.reduce((a, c) => a + Math.max(...c.levels.map((l) => l.points)), 0) ?? 0;
  const r = it.response;

  return (
    <Card title={<span>{it.student.name} <span className="font-normal text-ink-500">· {it.activity.title}</span></span>} actions={<span className="text-xs text-ink-500">{timeAgo(it.answered_at)}</span>}>
      <div className="space-y-3">
        <div className="flex items-start gap-2"><Badge>{it.question.kind}</Badge><RichText text={it.question.prompt} className="text-sm font-medium" /></div>
        <div className="rounded-lg bg-ink-50 p-3 text-sm">
          {typeof r.text === "string" && <p className="whitespace-pre-wrap">{r.text}</p>}
          {Array.isArray(r.strokes) && <svg viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} className="w-full max-w-lg rounded border border-ink-200 bg-white"><StrokeLayer strokes={r.strokes as Stroke[]} /></svg>}
          {typeof r.source === "string" && <CodeRunner language={(r.language as "javascript") ?? "javascript"} value={r.source} readOnly tests={(it.question.config.tests as never) ?? []} />}
          {typeof r.path === "string" && <button className="font-medium text-brand-700 underline" onClick={async () => {
            const { data } = await createClient().storage.from("submissions").createSignedUrl(r.path as string, 300);
            if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
          }}><Icon name="paperclip" className="inline h-3.5 w-3.5 align-[-2px]" /> {String(r.name ?? "Download file")}</button>}
          {Array.isArray(r.blanks) && <p>{(r.blanks as string[]).join(" · ")}</p>}
        </div>
        {rubric && (
          <div className="space-y-2">{rubric.criteria.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-2 text-xs"><span className="w-32 font-medium">{c.title}</span>
              {c.levels.map((l) => <button key={l.label} onClick={() => { const n = { ...picks, [c.id]: l.points }; setPicks(n); const t = Object.values(n).reduce((a, b) => a + b, 0); setScore(Math.round((t / max) * it.question.points * 10) / 10); }}
                className={`rounded border px-2 py-1 ${picks[c.id] === l.points ? "border-brand-500 bg-brand-600 text-white" : "border-ink-200"}`}>{l.label}</button>)}
            </div>
          ))}</div>
        )}
        <div className="grid gap-3 sm:grid-cols-[140px_1fr_auto] sm:items-end">
          <Field label={`Score / ${it.question.points}`}><Input type="number" min={0} max={it.question.points} step="0.5" value={score} onChange={(e) => setScore(Number(e.target.value))} /></Field>
          <Field label="Feedback to student"><Textarea rows={1} value={feedback} onChange={(e) => setFeedback(e.target.value)} /></Field>
          <Button onClick={async () => { try { await rpc("review_answer", { p_answer: it.answer_id, p_score: score, p_feedback: feedback }); toast("Marked", "success"); onDone(); } catch (e) { toast(errorText(e), "error"); } }}>Save</Button>
        </div>
      </div>
    </Card>
  );
}
