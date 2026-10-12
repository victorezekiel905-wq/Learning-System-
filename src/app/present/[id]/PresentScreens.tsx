"use client";
import type { ReactNode } from "react";
import { ArrowLeft, Hand, X } from "lucide-react";
import { Icon } from "@/components/Icon";
import type { RosterEntry, SessionState } from "@/components/live/types";
import { screenLive, screenPlaceholder, useStudentFrame, WhyNoScreens, type Screen } from "@/components/live/ScreenRail";
import { cn } from "@/lib/utils";

const here = (r: RosterEntry) => r.presence === "online" || r.presence === "idle";
const left = (r: RosterEntry) => !!r.web?.away_since || r.presence === "offline";

/**
 * Students' screens beside the lesson on Present: a column on the right on a laptop or
 * projector, a swipeable row above the lesson on a phone or tablet. Clicking one shows it
 * large on this screen only; students' own devices keep the lesson.
 */
export function ScreenStrip({ state, screens, shown, onShow, onHide }: {
  state: SessionState; screens: Record<string, Screen>; shown: string | null; onShow: (id: string) => void; onHide: () => void;
}) {
  // Everyone in the lesson, plus anyone who left it (in red) until they're back.
  const people = state.roster.filter((r) => here(r) || (r.presence === "offline" && !!r.web?.away_since));
  return (
    <aside aria-label="Students' screens"
      className="order-first border-b border-white/10 px-4 py-3 lg:sticky lg:top-0 lg:order-none lg:max-h-[100dvh] lg:w-72 lg:shrink-0 lg:self-start lg:overflow-y-auto lg:border-b-0 lg:border-l lg:px-3 lg:pb-24 xl:w-80">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Screens <span className="font-normal text-ink-300">· {people.filter(here).length} in class</span></p>
        <button type="button" onClick={onHide} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold text-ink-300 hover:bg-white/10 hover:text-white" title="Hide screens (V)">
          <X className="h-3.5 w-3.5" aria-hidden /> Hide
        </button>
      </div>
      <div className="mb-2 empty:hidden [&>p]:text-ink-300"><WhyNoScreens state={state} screens={screens} /></div>
      {people.length === 0 ? <p className="text-xs text-ink-300">Students appear here as they join.</p> : (
        <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-visible lg:px-0 [&>li]:w-36 [&>li]:shrink-0 [&>li]:snap-start lg:[&>li]:w-auto">
          {people.map((r) => {
            const sc = screens[r.student_id];
            const live = sc && !sc.stale && screenLive(r);
            const gone = left(r);
            const on = shown === r.student_id;
            return (
              <li key={r.student_id}>
                <button type="button" onClick={() => onShow(r.student_id)} aria-pressed={on} aria-label={`Show ${r.name}${r.guest ? " (guest)" : ""}'s screen${gone ? ", left the lesson" : ""}`}
                  title={on ? "Back to the lesson" : `Show ${r.name}'s screen`}
                  className={cn("block w-full overflow-hidden rounded-lg bg-ink-800 text-left ring-2 transition hover:ring-white/50 focus-visible:outline-none focus-visible:ring-accent-300",
                    on ? "ring-accent-400" : gone ? "ring-rose-500" : "ring-transparent")}>
                  <span className="relative block aspect-video bg-ink-950">
                    {live ? <img src={sc.image} alt="" className="h-full w-full object-cover" />
                      : <span className="grid h-full place-items-center px-2 text-center text-[11px] leading-tight text-ink-300">{gone ? "Left the lesson" : screenPlaceholder(r, state)}</span>}
                    {live && <span className="absolute left-1 top-1 rounded bg-rose-600 px-1 text-[9px] font-bold">LIVE</span>}
                    {gone && <span className="absolute inset-x-0 bottom-0 bg-rose-600 py-0.5 text-center text-[10px] font-bold">LEFT</span>}
                    {on && <span className="absolute right-1 top-1 rounded bg-accent-400 px-1 text-[9px] font-bold text-ink-950">SHOWING</span>}
                  </span>
                  <span className="flex items-center gap-1 px-2 py-1 text-xs font-medium">
                    <span className="truncate">{r.name}</span>
                    {r.guest && <span className="shrink-0 text-[10px] text-ink-300">guest</span>}
                    {r.hand_raised && <Hand className="ml-auto h-3.5 w-3.5 shrink-0 text-accent-300" aria-label="Hand up" />}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

/**
 * One student's screen, large, on Present. The lesson carries on underneath: the slide
 * shows small in the corner, the controls still move it, and a click goes back to it.
 */
export function ProjectedScreen({ state, sessionId, studentId, live, onBack, lesson, lessonLabel }: {
  state: SessionState; sessionId: string; studentId: string; live?: Screen; onBack: () => void; lesson?: ReactNode; lessonLabel: string;
}) {
  const r = state.roster.find((x) => x.student_id === studentId);
  const f = useStudentFrame(state, sessionId, studentId, live);
  return (
    <figure className="relative w-full max-w-6xl">
      <div className="overflow-hidden rounded-xl bg-black">
        {f?.image && !f.stale ? <img src={f.image} alt={`${r?.name ?? "Student"}'s screen`} className="mx-auto max-h-[70dvh] w-full object-contain" />
          : <div className="grid aspect-video place-items-center p-6 text-center text-lg text-ink-300">
              {!r ? "This student has left the lesson." : r.web?.away_since || r.presence === "offline" ? `${r.name} has left the lesson.` : !screenLive(r) ? screenPlaceholder(r, state) : "Waiting for the screen…"}
            </div>}
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
            <span className="pointer-events-none absolute left-0 top-0 block w-[960px] origin-top-left scale-[0.25]">{lesson}</span>
          </span>
          <span className="block bg-ink-950/90 px-2 py-1 text-xs text-white">{lessonLabel}</span>
        </button>
      )}
    </figure>
  );
}
