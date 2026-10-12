"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Play } from "lucide-react";
import { SlideView, type SlideData } from "@/components/slides/SlideView";
import { AnswerTiles } from "@/components/game/LiveGame";
import type { RosterEntry, SessionState } from "./types";

const W = 960, H = 540;
const TILE_KINDS = ["mcq", "true_false", "poll", "multi_select"];

/** Draws a 960×540 picture and shrinks it to fit its box. Nothing inside plays or takes clicks. */
function Scaled({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={box} className="relative aspect-video w-full overflow-hidden" aria-hidden inert>
      {scale > 0 && <div className="absolute left-0 top-0 origin-top-left" style={{ width: W, height: H, transform: `scale(${scale})` }}>{children}</div>}
    </div>
  );
}

function Panel({ children, className = "bg-ink-950 text-white" }: { children: ReactNode; className?: string }) {
  return <div className={`flex h-full w-full flex-col items-center justify-center gap-6 p-12 text-center ${className}`}>{children}</div>;
}

/**
 * What a student has in front of them in the lesson, drawn from the lesson itself (no
 * screen sharing needed): the waiting screen, "eyes on your teacher", the leaderboard,
 * the open question, or the slide they're on (their own slide when student-paced).
 */
export function StudentView({ r, state, slides, slide: teacherSlide, large = false, noStatus = false }: {
  r: RosterEntry; state: SessionState; slides: SlideData[]; slide: number;
  /** Shown big on Present: a bigger label. */ large?: boolean;
  /** Hide the answered label (they have left). */ noStatus?: boolean;
}) {
  const s = state.session;
  const phase = s.phase ?? "active";
  const pos = s.mode === "student_paced" ? (r.current_slide ?? teacherSlide) : teacherSlide;
  const sl = slides.find((x) => x.position === pos);
  const act = state.activity;
  const q0 = act?.questions[0];
  // The open question on the slide they're on: what they're answering, and whether they have.
  const onQuestion = !!act && !!sl?.activity && sl.activity.id === act.activity.id;
  const answered = onQuestion && (act!.answered_ids ?? []).includes(r.student_id);

  let screen: ReactNode;
  if (phase === "lobby") screen = <Panel><p className="text-6xl font-extrabold">You&apos;re in!</p><p className="text-3xl text-ink-300">Waiting for the lesson to start</p></Panel>;
  else if (phase === "paused") screen = <Panel><p className="text-7xl font-extrabold">👀 Eyes on your teacher</p></Panel>;
  else if (s.show_leaderboard) screen = <Panel><p className="text-7xl font-extrabold">🏆 Leaderboard</p></Panel>;
  else if (onQuestion && q0 && !act!.revealed) {
    screen = (
      <Panel className="bg-ink-50 text-ink-900">
        <p className="text-5xl font-extrabold leading-tight">{q0.prompt}</p>
        {TILE_KINDS.includes(q0.kind) && <AnswerTiles options={q0.options} big className="w-full" />}
      </Panel>
    );
  } else if (sl && (sl.kind === "video" || sl.kind === "embed" || sl.kind === "audio")) {
    screen = <Panel><Play className="h-28 w-28" /><p className="text-5xl font-bold">{sl.content.heading || (sl.kind === "audio" ? "Listening" : "Watching")}</p></Panel>;
  } else if (sl) screen = <SlideView slide={sl} />;
  else screen = <Panel><p className="text-5xl font-bold">{s.title ?? "Lesson"}</p></Panel>;

  return (
    <div className="relative">
      <Scaled>{screen}</Scaled>
      {onQuestion && !noStatus && phase === "active" && !s.show_leaderboard && (
        <span className={`absolute rounded font-bold ${large ? "bottom-3 left-3 px-3 py-1 text-base" : "bottom-1 left-1 px-1.5 py-0.5 text-[10px]"} ${answered ? "bg-emerald-700 text-white" : act!.revealed ? "bg-ink-600 text-white" : "bg-amber-400 text-ink-950"}`}>
          {answered ? "✓ Answered" : act!.revealed ? "No answer" : "Thinking…"}
        </span>
      )}
    </div>
  );
}
