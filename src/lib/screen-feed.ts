"use client";
// Teacher side of live screens: one private channel per joined student
// (screen:<session>:<student>, receive-only for the session's teachers, see
// app.can_listen). Frames are kept in memory only; nothing is stored.
import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";
import { openChannel } from "./realtime";
import type { LiveFrame } from "./classroom-guard";

export type FeedFrame = LiveFrame & { receivedAt: number };

export function useScreenFeed(sessionId: string, studentIds: string[], enabled: boolean) {
  const [frames, setFrames] = useState<Record<string, FeedFrame>>({});
  const channels = useRef(new Map<string, RealtimeChannel>());
  const key = enabled ? [...studentIds].sort().join(",") : "";

  useEffect(() => {
    const wanted = new Set(key ? key.split(",") : []);
    const open = channels.current;
    let cancelled = false;
    // Leave channels of students who left.
    for (const [id, ch] of open) {
      if (!wanted.has(id)) { void createClient().removeChannel(ch); open.delete(id); }
    }
    // Join channels of students who joined.
    for (const id of wanted) {
      if (open.has(id)) continue;
      void openChannel(`screen:${sessionId}:${id}`).then((ch) => {
        if (cancelled || open.has(id)) { void createClient().removeChannel(ch); return; }
        ch.on("broadcast", { event: "frame" }, ({ payload }) => {
          const f = payload as LiveFrame;
          if (typeof f?.image !== "string" || !f.image.startsWith("data:image/")) return;
          setFrames((prev) => ({ ...prev, [id]: { ...f, receivedAt: Date.now() } }));
        }).subscribe();
        open.set(id, ch);
      });
    }
    return () => { cancelled = true; };
  }, [sessionId, key]);

  // Close everything when leaving the live room.
  useEffect(() => () => {
    for (const ch of channels.current.values()) void createClient().removeChannel(ch);
    channels.current.clear();
  }, [sessionId]);

  return frames;
}
