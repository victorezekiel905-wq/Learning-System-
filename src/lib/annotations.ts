"use client";
import { useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";
import type { Stroke } from "./types";

/**
 * Teacher's live whiteboard annotation, broadcast over a private Realtime
 * channel (authorised by the realtime.messages policy in migration 0670:
 * only the session's teacher can send; only its class can listen).
 */
export function useAnnotations(sessionId: string, slide: number) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const channel = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    const sb = createClient();
    let ch: RealtimeChannel | null = null;
    let cancelled = false;
    (async () => {
      const { data } = await sb.auth.getSession();
      if (data.session) await sb.realtime.setAuth(data.session.access_token);
      if (cancelled) return;
      ch = sb.channel(`annot:${sessionId}`, { config: { private: true, broadcast: { self: false } } })
        .on("broadcast", { event: "stroke" }, ({ payload }) => {
          if (payload.slide === slide) setStrokes((s) => [...s, payload.stroke as Stroke]);
        })
        .on("broadcast", { event: "clear" }, ({ payload }) => { if (payload.slide === slide) setStrokes([]); })
        .subscribe();
      channel.current = ch;
    })();
    return () => { cancelled = true; if (ch) void sb.removeChannel(ch); channel.current = null; };
  }, [sessionId, slide]);

  useEffect(() => setStrokes([]), [slide]);

  return {
    strokes,
    setStrokes,
    send: (stroke: Stroke) => void channel.current?.send({ type: "broadcast", event: "stroke", payload: { slide, stroke } }),
    clear: () => { setStrokes([]); void channel.current?.send({ type: "broadcast", event: "clear", payload: { slide } }); }
  };
}
