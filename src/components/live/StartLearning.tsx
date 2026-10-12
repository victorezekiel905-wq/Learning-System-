"use client";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { Icon } from "@/components/Icon";
import type { useClassroomGuard } from "@/lib/classroom-guard";

type Guard = ReturnType<typeof useClassroomGuard>;

/**
 * The welcome step when a student joins: one "Start learning" tap takes them into the
 * lesson and turns on their teacher's view of their screen. Browsers always show their
 * own "choose what to share" box after the tap; no page can skip it, so the note says
 * what to pick. If it doesn't work they can try again or join without it, and turn it on
 * later from the lesson.
 * Phones and tablets can't share a screen from the browser, so they never see this.
 */
export function StartLearning({ guard, teacher, title }: { guard: Guard; teacher: string; title: string }) {
  const [done, setDone] = useState(false);
  const [tried, setTried] = useState(false);
  if (done || guard.sharing || !guard.needShare) return null;
  return (
    <div className="fixed inset-0 z-[70] grid place-items-center overflow-y-auto bg-ink-950 p-4 text-white" role="dialog" aria-modal="true" aria-labelledby="start-title">
      <div className="w-full max-w-md space-y-6 py-8 text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-accent-500 text-accent-ink">
          <Icon name="play" className="h-8 w-8" />
        </span>
        <div className="space-y-2">
          <p className="text-sm text-ink-300">{teacher}&apos;s lesson</p>
          <h1 id="start-title" className="text-[30px] font-extrabold leading-tight tracking-tightest">{title}</h1>
        </div>
        <Button size="lg" variant="accent" className="w-full text-lg" onClick={async () => {
          // Lets the lesson pop a "Return to your lesson" notice later, under lockdown.
          if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
          const ok = await guard.startShare();
          setTried(true);
          if (!ok) return;
          // Full screen too, while the tap still counts (some browsers allow it after the share box).
          if (guard.needFullscreen && !guard.fullscreen) await guard.enterFullscreen();
          setDone(true);
        }}>
          {tried ? "Try again" : "Start learning"}
        </Button>
        {tried && !guard.locked && <button type="button" className="text-sm font-semibold text-ink-300 underline hover:text-white" onClick={() => setDone(true)}>Join without it</button>}
        <p className="text-xs leading-relaxed text-ink-300">
          Your teacher can see your screen during the lesson, to help you and keep the class on track. It stops when the lesson ends.
          When your browser asks, choose <strong className="text-white">Entire screen</strong>, then <strong className="text-white">Share</strong>.
        </p>
        {guard.shareError && <Alert tone="error">{guard.shareError}</Alert>}
      </div>
    </div>
  );
}

/** In the lesson, for a student who skipped it: turn the teacher's view on again. */
export function StartLearningChip({ guard }: { guard: Guard }) {
  if (guard.sharing || !guard.needShare || guard.locked) return null;
  return (
    <Button size="sm" variant="secondary" onClick={() => void guard.startShare()} title="Choose Entire screen, then Share">
      <Icon name="monitor" className="h-4 w-4" /> Let your teacher see your work
    </Button>
  );
}
