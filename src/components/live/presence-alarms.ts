"use client";
import { useEffect, useRef } from "react";
import { useToast } from "@/components/ui";
import type { RosterEntry } from "./types";

/** Two short tones; silent until the teacher has clicked something (browser rule). */
export function beep(freq: number) {
  try {
    const ctx = new AudioContext();
    [0, 0.2].forEach((t) => {
      const o = ctx.createOscillator(); o.frequency.value = freq;
      o.connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.12);
    });
  } catch { /* audio blocked until the teacher interacts with the page */ }
}

/** A system notification, only when this tab is in the background and the teacher allowed them. */
export function osNotify(title: string, body?: string) {
  if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(title, { body, tag: `swiftcipher-${title}` });
  }
}

type Seen = { here: boolean; joined: boolean; away: string | null; name: string };

/**
 * Leaving and coming back, for students and guests alike:
 *  * closed the lesson or the browser: instant (the page says so as it closes);
 *  * switched away under lockdown: instant, with the reason;
 *  * went quiet (device off, battery, no internet): once the presence window passes.
 * Each rings the alarm (unless sound is off) and pops up; coming back, rejoining on
 * another device, and (once the lesson has started) joining are announced too.
 */
export function usePresenceAlarms(roster: RosterEntry[] | undefined, sound: boolean, announceJoins = false) {
  const toast = useToast();
  const seen = useRef<Map<string, Seen> | null>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;
  useEffect(() => {
    if (!roster) return;
    const first = seen.current === null;
    const prev = seen.current ?? new Map<string, Seen>();
    const next = new Map<string, Seen>();
    const alarm = (title: string, why: string) => {
      toast(`${title}: ${why}`, "error");
      if (soundRef.current) { beep(880); window.setTimeout(() => beep(660), 380); }
      osNotify(title, why);
    };
    for (const r of roster) {
      const here = r.presence === "online" || r.presence === "idle";
      const away = r.web?.away_since ?? null;
      const joined = r.presence !== "not_joined";
      next.set(r.student_id, { here, joined, away, name: r.name });
      if (first) continue;
      const before = prev.get(r.student_id);
      if (away && !before?.away) {
        alarm(`${r.name} left the lesson`, r.web?.away_reason ?? "Left the lesson");
      } else if (before?.here && !here && !away) {
        alarm(`${r.name} lost connection`, "Their device went off or lost the internet. They can rejoin with the same code.");
      } else if (before?.joined && (!before.here || before.away) && here && !away) {
        toast(`${r.name} is back in the lesson`, "success");
      } else if (!before?.joined && here) {
        const earlier = [...prev.entries()].find(([id, v]) => id !== r.student_id && v.name.toLowerCase() === r.name.toLowerCase());
        if (earlier) toast(`${r.name} rejoined on another device`, "success");
        else if (announceJoins) toast(`${r.name} joined the lesson`, "success");
      }
    }
    seen.current = next;
  }, [roster, toast, announceJoins]);
}
