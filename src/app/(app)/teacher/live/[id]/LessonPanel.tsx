"use client";
import Link from "next/link";
import { useState } from "react";
import { TeacherBroadcast } from "@/components/live/RtcBroadcast";
import { SlideView, type SlideData } from "@/components/slides/SlideView";
import { BOARD_H, BOARD_W, StrokeLayer, Whiteboard } from "@/components/slides/Whiteboard";
import { Alert, Badge, Button, Select, Toggle, useToast } from "@/components/ui";
import type { SessionState } from "@/components/live/types";
import { useAnnotations } from "@/lib/annotations";
import { createClient } from "@/lib/supabase/client";
import { useLoader } from "@/lib/hooks";
import { errorText, rpc } from "@/lib/rpc";
import type { Me } from "./LiveRoom";

type Payload = { lesson: { id: string; title: string } | null; slides: SlideData[] };

export function LessonPanel({ state, me, reload }: { state: SessionState; me: Me; reload: () => Promise<void> }) {
  const toast = useToast();
  const s = state.session;
  const [annotate, setAnnotate] = useState(false);
  const lesson = useLoader(() => rpc<Payload>("session_lesson", { p_session: s.id }), [s.id]);
  const notes = useLoader(async () => {
    if (!s.lesson_id) return {} as Record<number, string>;
    const { data } = await createClient().from("lesson_slides").select("position,notes").eq("lesson_id", s.lesson_id);
    return Object.fromEntries((data ?? []).map((r) => [r.position, r.notes as string]));
  }, [s.lesson_id]);
  const ann = useAnnotations(s.id, s.current_slide);

  const slides = lesson.data?.slides ?? [];
  const slide = slides.find((x) => x.position === s.current_slide) ?? slides[0];

  async function update(args: Record<string, unknown>) {
    try { await rpc("set_session_state", { p_session: s.id, ...args }); await reload(); }
    catch (e) { toast(errorText(e), "error"); }
  }

  if (!s.lesson_id) {
    return (
      <div className="space-y-4">
        <Alert>This session has no lesson. Use Responses to run quick activities, or the Screens and Environment tabs to manage devices.</Alert>
        <TeacherBroadcast sessionId={s.id} />
      </div>
    );
  }
  if (!slide) return <p className="text-sm text-ink-500">Loading lesson…</p>;
  const isActivity = slide.kind === "activity" && slide.activity;
  const launched = isActivity && s.active_activity_id === slide.activity!.id;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button variant="secondary" disabled={s.current_slide <= 0} onClick={() => update({ p_slide: s.current_slide - 1 })}>← Prev</Button>
          <span className="text-sm font-medium">Slide {s.current_slide + 1} / {slides.length}</span>
          <Button variant="secondary" disabled={s.current_slide >= slides.length - 1} onClick={() => update({ p_slide: s.current_slide + 1 })}>Next →</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select className="w-auto py-1 text-xs" value={s.mode} onChange={(e) => update({ p_mode: e.target.value })} aria-label="Delivery mode">
            <option value="live_participation">Live participation</option><option value="student_paced">Student-paced</option><option value="front_of_class">Front of class</option>
          </Select>
          <Button size="sm" variant={annotate ? "primary" : "secondary"} onClick={() => setAnnotate((v) => !v)}>{annotate ? "Stop drawing" : "Draw on slide"}</Button>
        </div>
      </div>

      {s.mode === "student_paced" && <Alert>Student-paced: students move through the slides at their own speed. Their progress shows in the roster.</Alert>}

      <div className="relative">
        <SlideView slide={slide} overlay={!annotate && ann.strokes.length ? (
          <svg viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} className="h-full w-full"><StrokeLayer strokes={ann.strokes} /></svg>
        ) : undefined} />
        {annotate && (
          <div className="absolute inset-0 rounded-xl bg-white/5">
            <Whiteboard className="h-full [&>svg]:h-full [&>svg]:bg-transparent" strokes={ann.strokes}
              onChange={(next) => { if (next.length === 0) ann.clear(); else ann.setStrokes(next); }} onStroke={ann.send} />
          </div>
        )}
      </div>

      {isActivity && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50 p-3">
          <div><p className="font-semibold">{slide.activity!.title}</p><p className="text-xs text-ink-600">{launched ? "Open: students are answering now." : "Launch to open this activity on every student's screen."}</p></div>
          <div className="flex gap-2">
            {launched ? <Button variant="secondary" onClick={() => update({ p_clear_activity: true })}>Close activity</Button>
              : <Button onClick={() => update({ p_activity: slide.activity!.id })}>Launch activity</Button>}
            {(slide.activity!.kind === "quiz" || slide.activity!.kind === "multiple_choice") && (
              <Link className="btn btn-accent no-underline" href={`/teacher/challenge/new?class=${s.class_id}&activity=${slide.activity!.id}&session=${s.id}`}>Play as Challenge</Link>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 overflow-x-auto pb-1">
        {slides.map((sl) => (
          <button key={sl.id} onClick={() => update({ p_slide: sl.position })}
            className={`shrink-0 rounded-lg border px-3 py-2 text-left text-xs ${sl.position === s.current_slide ? "border-brand-500 bg-brand-50" : "border-ink-200 bg-white"}`}>
            <span className="font-bold text-ink-400">{sl.position + 1}</span> <Badge>{sl.kind}</Badge>
            <span className="mt-1 block max-w-[9rem] truncate">{sl.activity?.title ?? sl.content.heading ?? ""}</span>
          </button>
        ))}
      </div>

      <TeacherBroadcast sessionId={s.id} />

      <div className="grid gap-4 md:grid-cols-2">
        {notes.data?.[s.current_slide] && <Alert title="Speaker notes">{notes.data[s.current_slide]}</Alert>}
        <div className="card space-y-3 p-4">
          <Toggle checked={s.responses_visible} onChange={(v) => update({ p_responses_visible: v })} label="Share results with students" description="Students see anonymous totals for the open activity." />
          <Toggle checked={s.group_chat_enabled} disabled={!state.settings.allow_group_chat} onChange={(v) => update({ p_group_chat: v })}
            label="Class group chat" description={state.settings.allow_group_chat ? "Students can talk in a moderated class thread." : "Turned off by your school's policy."} />
        </div>
      </div>
      <p className="text-[11px] text-ink-400">Signed in as {me.name}. Slides are version {lesson.data?.lesson ? "as published" : ""}.</p>
    </div>
  );
}
