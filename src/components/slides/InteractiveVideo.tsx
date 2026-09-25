"use client";
import { useEffect, useRef, useState } from "react";
import { Prompt, QuestionInput, isAnswered, type Answer } from "@/components/activities/QuestionInput";
import { Alert, Badge, Button, useToast } from "@/components/ui";
import { errorText, rpc } from "@/lib/rpc";
import { sendOrQueue } from "@/lib/offline-queue";
import type { PublicQuestion } from "@/lib/types";
import { SlideView, type SlideData } from "./SlideView";
import { Icon } from "@/components/Icon";

type Checkpoint = { id: string; t_seconds: number; required: boolean; question_id: string; activity_id: string };
type Attempt = { attempt: { id: string }; questions: PublicQuestion[]; answers: Record<string, Answer> };

/**
 * Interactive video (§3.1): pauses at each checkpoint until the student answers.
 * Seeking past an unanswered required checkpoint jumps back to it.
 */
export function InteractiveVideo({ slide, checkpoints, sessionId, shareCode }: {
  slide: SlideData; checkpoints: Checkpoint[]; sessionId?: string; shareCode?: string;
}) {
  const toast = useToast();
  const video = useRef<HTMLVideoElement>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [active, setActive] = useState<Checkpoint | null>(null);
  const [answer, setAnswer] = useState<Answer | undefined>();
  const [result, setResult] = useState<{ is_correct?: boolean; explanation?: string | null } | null>(null);
  const activityId = checkpoints[0]?.activity_id;

  useEffect(() => {
    if (!activityId) return;
    rpc<Attempt>("start_attempt", { p_activity: activityId, p_session: sessionId ?? null, p_share: shareCode ?? null })
      .then((a) => { setAttempt(a); setDone(new Set(Object.keys(a.answers ?? {}))); })
      .catch((e) => toast(errorText(e), "error"));
  }, [activityId, sessionId, shareCode, toast]);

  const byQ = Object.fromEntries((attempt?.questions ?? []).map((q) => [q.id, q]));
  const sorted = [...checkpoints].sort((a, b) => a.t_seconds - b.t_seconds);

  function onTime(t: number, el: HTMLVideoElement) {
    if (active) return;
    const due = sorted.find((c) => !done.has(c.question_id) && t >= c.t_seconds - 0.25 && (c.required || t < c.t_seconds + 1));
    if (due) {
      el.pause();
      if (due.required && t > due.t_seconds + 1) el.currentTime = due.t_seconds;
      setActive(due); setAnswer(undefined); setResult(null);
    }
  }

  async function submit() {
    if (!attempt || !active) return;
    const q = byQ[active.question_id];
    if (!q || !isAnswered(q, answer)) return;
    try {
      const r = await sendOrQueue<{ is_correct?: boolean; explanation?: string | null }>("submit_answer", { p_attempt: attempt.attempt.id, p_question: q.id, p_response: answer });
      setResult("queued" in r ? { explanation: "Saved offline; it will sync." } : r);
      setDone((d) => new Set(d).add(q.id));
    } catch (e) { toast(errorText(e), "error"); }
  }

  const directVideo = !!slide.content.media_path || /\.(mp4|webm|ogg)(\?|$)/i.test(slide.content.url ?? "");
  const q = active ? byQ[active.question_id] : undefined;

  return (
    <div className="space-y-3">
      <div className="relative">
        <SlideView slide={slide} videoRef={video} onVideoTime={onTime} />
        {active && q && (
          <div className="absolute inset-0 z-10 overflow-y-auto rounded-xl bg-white/95 p-6 backdrop-blur">
            <p className="mb-2 text-[13px] font-semibold text-ink-600">Checkpoint · {Math.floor(active.t_seconds / 60)}:{String(Math.round(active.t_seconds % 60)).padStart(2, "0")}</p>
            <Prompt q={q} />
            <div className="mt-3"><QuestionInput q={q} value={answer} onChange={setAnswer} disabled={!!result} /></div>
            {result && <div className="mt-3"><Alert tone={result.is_correct === false ? "warn" : "success"}>{result.is_correct === true ? "Correct!" : result.is_correct === false ? "Not quite." : "Saved."} {result.explanation}</Alert></div>}
            <div className="mt-4 flex gap-2">
              {!result ? <Button onClick={submit} disabled={!isAnswered(q, answer)}>Submit</Button>
                : <Button onClick={() => { setActive(null); void video.current?.play(); }}>Continue video</Button>}
              {!active.required && !result && <Button variant="ghost" onClick={() => { setDone((d) => new Set(d).add(active.question_id)); setActive(null); void video.current?.play(); }}>Skip</Button>}
            </div>
          </div>
        )}
      </div>
      {sorted.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-500">Checkpoints:</span>
          {sorted.map((c) => (
            <button key={c.id} className="badge border border-ink-200 bg-white" disabled={directVideo && !done.has(c.question_id)}
              onClick={() => { if (!directVideo || done.has(c.question_id)) { setActive(c); setAnswer(undefined); setResult(null); } }}>
              <Icon name={done.has(c.question_id) ? "check" : "circle"} className="h-3 w-3" />{done.has(c.question_id) && <span className="sr-only">Answered: </span>}{Math.floor(c.t_seconds / 60)}:{String(Math.round(c.t_seconds % 60)).padStart(2, "0")}
            </button>
          ))}
          {!directVideo && <Badge tone="amber">Answer these as you reach each time in the video.</Badge>}
        </div>
      )}
    </div>
  );
}
