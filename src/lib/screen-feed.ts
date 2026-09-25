"use client";
// Teacher side of live screens: one private channel per joined student
// (screen:<session>:<student>, receive-only for the session's teachers, see
// app.can_listen). Frames are kept in memory only; nothing is stored.
import { useEffect, useRef, useState } from "react";
import { listen } from "./realtime";
import type { LiveFrame } from "./classroom-guard";

export type FeedFrame = LiveFrame & { receivedAt: number };

export function useScreenFeed(sessionId: string, studentIds: string[], enabled: boolean) {
  const [frames, setFrames] = useState<Record<string, FeedFrame>>({});
  const stops = useRef(new Map<string, () => void>());
  const key = enabled ? [...studentIds].sort().join(",") : "";

  useEffect(() => {
    const wanted = new Set(key ? key.split(",") : []);
    const open = stops.current;
    // Stop listening to students who left, and drop their last frame.
    for (const [id, stop] of open) {
      if (!wanted.has(id)) { stop(); open.delete(id); setFrames((prev) => { const n = { ...prev }; delete n[id]; return n; }); }
    }
    // Listen to students who joined.
    for (const id of wanted) {
      if (open.has(id)) continue;
      open.set(id, listen(`screen:${sessionId}:${id}`, (event, payload) => {
        if (event !== "frame") return;
        const f = payload as LiveFrame;
        if (typeof f?.image !== "string" || !f.image.startsWith("data:image/")) return;
        setFrames((prev) => ({ ...prev, [id]: { ...f, receivedAt: Date.now() } }));
      }));
    }
  }, [sessionId, key]);

  // Stop everything when leaving the live room.
  useEffect(() => () => {
    for (const stop of stops.current.values()) stop();
    stops.current.clear();
  }, [sessionId]);

  return frames;
}
