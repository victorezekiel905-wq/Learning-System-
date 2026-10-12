"use client";
import type { ReactNode } from "react";
import { ArrowLeft, Hand, X } from "lucide-react";
import { Icon } from "@/components/Icon";
import type { SlideData } from "@/components/slides/SlideView";
import type { RosterEntry, SessionState } from "@/components/live/types";
import { screenLive, useStudentFrame, type Screen } from "@/components/live/ScreenRail";
import { StudentView } from "@/components/live/StudentView";
import { cn } from "@/lib/utils";

const here = (r: RosterEntry) => r.presence === "online" || r.presence === "idle";
const gone = (r: RosterEntry) => !!r.web?.away_since || r.presence === "offline";
/** Not looking at the lesson right now (another tab or app), but not counted as left yet. */
const elsewhere = (r: RosterEntry) => here(r) && !gone(r) && r.web?.visible === false;

/** A real picture of the student's screen, when they happen to be sharing it. */
export function liveFrame(r: RosterEntry, screens: Record<string, Screen>) {
  const sc = screens[r.student_id];
  return sc && !sc.stale && screenLive(r) ? sc : undefined;
}

function LeftCover({ r }: { r: RosterEntry }) {
  return (
    <span className="absolute inset-0 grid place-items-center bg-ink-950/90 px-2 text-center">
      <span>
        <span className="block text-[11px] font-bold text-rose-300">Left the lesson</span>
        <span className="block text-[10px] text-ink-300">{r.web?.away_reason ?? "Lost connection"}</span>
      </span>
    </span>
  );
}

/**
 * Everyone who joined, beside the lesson on Present: a column on the right on a laptop
 * or projector, a swipeable row above the lesson on a phone or tablet. Each shows what
 * that student has in front of them in the lesson (no screen sharing needed); someone who
 * leaves turns red, and their lesson comes back when they do. Clicking one shows it
 * large on this screen only; students' own devices keep the lesson.
 */
export function ScreenStrip({ state, screens, slides, slide, shown, onShow, onHide }: {
  state: SessionState; screens: Record<string, Screen>; slides: SlideData[]; slide: number;
  shown: string | null; onShow: (id: string) => void; onHide: () => void;
}) {
  const people = state.roster.filter((r) => r.presence !== "not_joined");
  return (
    <aside aria-label="Students' screens"
      className="order-first border-b border-white/10 px-4 py-3 lg:sticky lg:top-0 lg:order-none lg:max-h-[100dvh] lg:w-72 lg:shrink-0 lg:self-start lg:overflow-y-auto lg:border-b-0 lg:border-l lg:px-3 lg:pb-24 xl:w-80">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Students <span className="font-normal text-ink-300">· {people.filter(here).length} in class</span></p>
        <button type="button" onClick={onHide} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-ink-300 hover:bg-white/10 hover:text-white" title="Hide students' screens (V)">
          <X className="h-3.5 w-3.5" aria-hidden /> Hide
        </button>
      </div>
      {people.length === 0 ? <p className="text-xs text-ink-300">Students appear here as they join.</p> : (
        <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0 [&>li]:w-36 [&>li]:shrink-0 [&>li]:snap-start lg:[&>li]:w-auto">
          {people.map((r) => {
            const frame = liveFrame(r, screens);
            const out = gone(r);
            const on = shown === r.student_id;
            return (
              <li key={r.student_id} className="group relative">
                <div className={cn("overflow-hidden rounded-lg bg-ink-800 ring-2 transition",
                  on ? "ring-accent-400" : out ? "ring-rose-500" : "ring-transparent group-hover:ring-white/50")}>
                  <div className="relative aspect-video bg-ink-950">
                    {frame ? <img src={frame.image} alt="" className="h-full w-full object-cover" />
                      : <StudentView r={r} state={state} slides={slides} slide={slide} noStatus={out} />}
                    {out && <LeftCover r={r} />}
                    {elsewhere(r) && <span className="absolute inset-x-0 top-0 bg-amber-400 py-0.5 text-center text-[10px] font-bold text-ink-950">Not on the lesson</span>}
                    {on && <span className="absolute right-1 top-1 rounded bg-accent-400 px-1 text-[9px] font-bold text-ink-950">SHOWING</span>}
                  </div>
                  <p className="flex items-center gap-1 px-2 py-1 text-xs font-medium">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", out ? "bg-rose-500" : "bg-emerald-400")} aria-hidden />
                    <span className="truncate">{r.name}</span>
                    {r.guest && <span className="shrink-0 text-[10px] text-ink-300">guest</span>}
                    {r.hand_raised && <Hand className="ml-auto h-3.5 w-3.5 shrink-0 text-accent-300" aria-label="Hand up" />}
                  </p>
                </div>
                <button type="button" onClick={() => onShow(r.student_id)} aria-pressed={on}
                  aria-label={`Show ${r.name}${r.guest ? " (guest)" : ""}'s screen${out ? ", left the lesson" : ""}`}
                  title={on ? "Back to the lesson" : `Show ${r.name}'s screen`}
                  className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300" />
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

/**
 * One student's screen, large, on Present: their real screen if they're sharing it,
 * otherwise what they have in front of them in the lesson. The lesson carries on
 * underneath: the slide shows small in the corner, the controls still move it, and a
 * click goes back to it.
 */
export function ProjectedScreen({ state, sessionId, studentId, screens, slides, slide, onBack, lesson, lessonLabel }: {
  state: SessionState; sessionId: string; studentId: string; screens: Record<string, Screen>; slides: SlideData[]; slide: number;
  onBack: () => void; lesson?: ReactNode; lessonLabel: string;
}) {
  const r = state.roster.find((x) => x.student_id === studentId);
  const live = r ? liveFrame(r, screens) : undefined;
  return (
    <figure className="relative w-full max-w-6xl">
      <div className="relative overflow-hidden rounded-xl bg-black">
        {!r ? <div className="grid aspect-video place-items-center text-lg text-ink-300">This student has left the lesson.</div>
          : live ? <LiveScreen state={state} sessionId={sessionId} r={r} live={live} />
          : <StudentView r={r} state={state} slides={slides} slide={slide} large noStatus={gone(r)} />}
        {r && gone(r) && <span className="absolute inset-0 grid place-items-center bg-ink-950/85 text-center text-2xl font-bold text-rose-300">{r.name} has left the lesson</span>}
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-xl font-semibold"><Icon name="star" className="inline h-5 w-5 align-[-3px] text-accent-400" /> {r?.name ?? "Student"}&apos;s screen</span>
        <button type="button" onClick={onBack} className="inline-flex items-center gap-2 rounded-full bg-accent-400 px-4 py-2.5 text-sm font-semibold text-ink-950 hover:bg-accent-300">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back to the lesson
        </button>
      </figcaption>
      {lesson && (
        <button type="button" onClick={onBack} title="Back to the lesson"
          className="absolute bottom-16 right-3 hidden w-60 overflow-hidden rounded-lg text-left shadow-2xl ring-2 ring-white/70 transition hover:ring-accent-300 sm:block">
          <span className="relative block aspect-video overflow-hidden bg-white text-ink-900">
            <span className="pointer-events-none absolute left-0 top-0 block w-[960px] origin-top-left scale-[0.25]" inert>{lesson}</span>
          </span>
          <span className="block bg-ink-950/90 px-2 py-1 text-xs text-white">{lessonLabel}</span>
        </button>
      )}
    </figure>
  );
}

/** A shared screen, with sharper frames asked for while it's up. */
function LiveScreen({ state, sessionId, r, live }: { state: SessionState; sessionId: string; r: RosterEntry; live: Screen }) {
  const f = useStudentFrame(state, sessionId, r.student_id, live.source === "web" ? live : undefined);
  const img = f?.image && !f.stale ? f.image : live.image;
  return <img src={img} alt={`${r.name}'s screen`} className="mx-auto max-h-[70dvh] w-full object-contain" />;
}
