"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Gamepad2, Lock, MoreHorizontal, Square } from "lucide-react";
import { TimerRing, type LiveTimer } from "@/components/game/LiveGame";
import { Icon } from "@/components/Icon";
import { Button, Menu, useToast, type MenuItem } from "@/components/ui";
import type { SessionState } from "@/components/live/types";
import { formatJoinCode } from "@/lib/utils";

export type ControlAction = "start" | "pause" | "resume" | "leaderboard" | "next" | "prev" | "reveal";

/**
 * The control room's top bar. Only what fits the moment is a button:
 *   lobby: Start · question open: Reveal, Pause · after the reveal: Leaderboard, Pause · paused: Resume.
 * Present and End are always there; lockdown, the Challenge game and copying the code are under More.
 */
export function ControlBar({ state: s, sessionId, joined, timer, skew, monitoring, onControl, onLockdown, onEnd }: {
  state: SessionState; sessionId: string; joined: number; timer: LiveTimer | null; skew: number; monitoring: boolean;
  onControl: (action: ControlAction, args?: Record<string, unknown>) => void;
  onLockdown: () => void; onEnd: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const phase = s.session.phase ?? "active";
  const open = phase === "active" && !!s.activity && !s.activity.revealed;
  const copy = async () => {
    try { await navigator.clipboard.writeText(s.session.join_code); toast("Join code copied", "success"); }
    catch { toast("Couldn't copy. The code is on the screen.", "error"); }
  };
  const more: MenuItem[] = [
    ...(monitoring ? [{ label: s.session.lockdown ? "Turn lockdown off" : "Turn lockdown on", icon: <Lock className="h-4 w-4" aria-hidden />, onSelect: onLockdown }] : []),
    { label: "Copy join code", icon: <Copy className="h-4 w-4" aria-hidden />, onSelect: copy },
    // Challenges are for one class's students; a lesson without a class plays its question slides as the game.
    ...(s.session.class_id ? [{ label: "Start a Challenge game", icon: <Gamepad2 className="h-4 w-4" aria-hidden />,
      onSelect: () => router.push(`/teacher/challenge/new?class=${s.session.class_id}&session=${sessionId}${s.session.active_activity_id ? `&activity=${s.session.active_activity_id}` : ""}`) }] : [])
  ];
  const dark = "btn btn-sm border border-white/20 bg-white/5 text-white no-underline hover:bg-white/15 hover:text-white";

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 bg-ink-950 px-4 py-3 text-white sm:px-6">
      <div className="min-w-0 flex-1 basis-60">
        <p className="truncate text-[13px] text-ink-400">{s.session.class_name}{s.session.lesson_title && ` · ${s.session.lesson_title}`}</p>
        <h1 className="flex items-center gap-2.5 text-lg font-bold text-white sm:text-xl">
          {phase === "lobby" ? <span className="inline-flex shrink-0 items-center rounded-md bg-accent-500 px-1.5 py-1 text-[11px] font-bold leading-none text-accent-ink">LOBBY</span>
            : phase === "paused" ? <span className="inline-flex shrink-0 items-center rounded-md bg-amber-400 px-1.5 py-1 text-[11px] font-bold leading-none text-ink-950">PAUSED</span>
            : <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-rose-600 px-1.5 py-1 text-[11px] font-bold leading-none text-white">
              <span className="h-1.5 w-1.5 animate-pulse2 rounded-full bg-white" aria-hidden />LIVE</span>}
          <span className="truncate">{s.session.title}</span>
        </h1>
      </div>
      <div className="flex items-stretch gap-2.5">
        <button type="button" onClick={copy} title="Copy the join code" className="rounded-xl bg-accent-500 px-3.5 py-1.5 text-left text-accent-ink transition hover:bg-accent-400">
          <span className="block text-[11px] font-semibold leading-tight">Join code</span>
          <span className="block font-mono text-xl font-extrabold leading-tight tracking-[0.18em] sm:text-2xl">{formatJoinCode(s.session.join_code)}</span>
        </button>
        <div className="rounded-xl border border-white/15 px-3.5 py-1.5">
          <p className="text-[11px] font-semibold leading-tight text-ink-400">{open ? "Answered" : "Joined"}</p>
          <p className="font-display text-xl font-extrabold leading-tight tabular-nums sm:text-2xl">
            {open ? <>{s.activity!.answered ?? 0}<span className="text-ink-400">/{s.activity!.joined ?? joined}</span></>
              : <>{joined}{s.session.class_id && <span className="text-ink-400">/{s.roster.length}</span>}</>}
          </p>
        </div>
        {open && timer && <TimerRing timer={timer} skew={skew} size={52} className="self-center text-white" />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {phase === "lobby" && <Button size="sm" variant="accent" onClick={() => onControl("start")} title="Start the lesson (S)">Start lesson</Button>}
        {open && <Button size="sm" variant="accent" onClick={() => onControl("reveal")} title="Close the question and show the right answers (R)">Reveal answers</Button>}
        {phase === "active" && !open && s.ranking && (
          <Button size="sm" variant={s.session.show_leaderboard ? "accent" : "secondary"} aria-pressed={!!s.session.show_leaderboard}
            className={s.session.show_leaderboard ? undefined : dark}
            title={s.session.settings?.leaderboard === false ? "The class leaderboard is off for this lesson; only you see the scores" : "Show the top 5 on every screen (L)"}
            onClick={() => onControl("leaderboard", { show: !s.session.show_leaderboard })}>
            <Icon name="trophy" className="h-4 w-4" /> {s.session.show_leaderboard ? "Hide leaderboard" : "Leaderboard"}
          </Button>
        )}
        {phase === "active" && <Button size="sm" variant="secondary" className={dark} onClick={() => onControl("pause")} title="Students see 'Eyes on your teacher' until you resume (P)">Pause</Button>}
        {phase === "paused" && <Button size="sm" variant="accent" onClick={() => onControl("resume")} title="Carry on (P)">Resume</Button>}
        <Link href={`/present/${sessionId}`} className={dark} title="Full-screen view for the projector, with its own controls"><Icon name="monitor" className="h-4 w-4" /> Present</Link>
        <Menu items={more} label="More lesson actions" triggerClassName={dark}
          trigger={<><MoreHorizontal className="h-4 w-4" aria-hidden /> More</>} />
        <Button size="sm" variant="danger" onClick={onEnd} title="End the lesson for everyone and save its report"><Square className="h-3.5 w-3.5" fill="currentColor" aria-hidden /> End</Button>
      </div>
    </div>
  );
}
