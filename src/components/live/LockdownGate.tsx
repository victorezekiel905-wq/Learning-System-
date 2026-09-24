"use client";
import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { Icon } from "@/components/Icon";
import type { useClassroomGuard } from "@/lib/classroom-guard";
import { cn } from "@/lib/utils";

type Guard = ReturnType<typeof useClassroomGuard>;

/**
 * Covers the lesson until the student is "in class": sharing their screen and
 * in full screen. Shown again whenever they leave (switch tab/app, exit full
 * screen, stop sharing); the teacher is alerted after the grace period.
 */
export function LockdownGate({ guard, teacher }: { guard: Guard; teacher: string }) {
  const [started, setStarted] = useState(false);
  if (!guard.blocked) return null;
  const left = started || guard.directives?.away;
  const shareDone = !guard.needShare || guard.sharing;
  const fsDone = !guard.needFullscreen || guard.fullscreen;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-ink-900/95 p-4 text-white" role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <div className="w-full max-w-lg space-y-5 py-8">
        <div className="space-y-2 text-center">
          <span className={cn("mx-auto grid h-14 w-14 place-items-center rounded-2xl", left ? "bg-rose-500" : "bg-brand-500")}>
            <Icon name={left ? "alert" : "lock"} className="h-7 w-7" />
          </span>
          <h1 id="gate-title" className="text-2xl font-extrabold">
            {left ? "Return to the lesson" : `Join ${teacher}'s class`}
          </h1>
          <p className="text-sm text-ink-300">
            {left
              ? guard.directives?.reason
                ? `${guard.directives.reason}. Your teacher is notified if you stay away.`
                : "Your teacher is notified if you stay away from the lesson."
              : "This class is in lockdown. Your teacher can see your screen during the lesson, and gets an alert if you leave it."}
          </p>
        </div>

        <ol className="space-y-3">
          {guard.needShare && (
            <Step n={1} done={shareDone} title="Share your entire screen"
              hint="When your browser asks, choose “Entire screen” and press Share. Sharing stops when the class ends.">
              <Button onClick={async () => { if (await guard.startShare()) setStarted(true); }}>
                <Icon name="monitor" className="h-4 w-4" /> Share screen
              </Button>
            </Step>
          )}
          {guard.needFullscreen && (
            <Step n={guard.needShare ? 2 : 1} done={fsDone} title="Open the lesson full screen"
              hint="Stay in full screen. Leaving it, switching tabs or apps, or minimising counts as leaving the class.">
              <Button disabled={!shareDone} onClick={async () => {
                // Lets the class pop a "Return to your lesson" notice over other apps (e.g. games).
                if (typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission();
                await guard.enterFullscreen(); setStarted(true);
              }}>
                <Icon name="maximize" className="h-4 w-4" /> Enter full screen
              </Button>
            </Step>
          )}
          {shareDone && fsDone && !guard.visible && (
            <Step n={1} done={false} title="Click here to come back to the lesson" hint="The lesson must stay in front while the class is running.">
              <Button onClick={() => window.focus()}>I'm back</Button>
            </Step>
          )}
        </ol>

        {guard.shareError && <Alert tone="error">{guard.shareError}</Alert>}
        {guard.unsupported && (
          <p className="text-center text-xs text-ink-400">This device can't share its screen from the browser, so keep the lesson open and in front.</p>
        )}
      </div>
    </div>
  );
}

function Step({ n, done, title, hint, children }: { n: number; done: boolean; title: string; hint: string; children: React.ReactNode }) {
  return (
    <li className={cn("flex items-start gap-3 rounded-xl border p-4", done ? "border-emerald-400/40 bg-emerald-500/10" : "border-white/15 bg-white/5")}>
      <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold", done ? "bg-emerald-500" : "bg-white/15")}>
        {done ? <Icon name="check" className="h-4 w-4" /> : n}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="font-semibold">{title}</p>
        <p className="text-xs text-ink-300">{hint}</p>
        {!done && children}
      </div>
    </li>
  );
}
