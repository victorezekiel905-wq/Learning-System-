"use client";
import { useEffect } from "react";
import { rpc } from "@/lib/rpc";

/**
 * The teacher's pages for a live lesson (control room, Present, a game hosted
 * from it) say "here" every 20 seconds, and "left" when the tab is closed or the
 * teacher moves elsewhere in the app. The lesson ends 45 seconds after the
 * teacher left, or 3 minutes after the last "here" (migration 1020). Going from
 * the control room to Present says "here" again at once, so it carries on.
 */
export function useTeacherPresence(sessionId: string | null | undefined) {
  useEffect(() => {
    if (!sessionId) return;
    const here = () => { rpc("teacher_here", { p_session: sessionId }).catch(() => { /* next beat */ }); };
    here();
    const beat = window.setInterval(here, 20_000);
    const onVisible = () => { if (document.visibilityState === "visible") here(); };
    // Closing the tab or browser: the page can't wait for an answer, so a beacon.
    const onClose = () => {
      navigator.sendBeacon?.("/api/live/teacher-left", new Blob([JSON.stringify({ session_id: sessionId })], { type: "application/json" }));
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onClose);
    return () => {
      window.clearInterval(beat);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onClose);
      // Moved elsewhere in the app.
      rpc("teacher_here", { p_session: sessionId, p_here: false }).catch(() => { /* the 3-minute rule still applies */ });
    };
  }, [sessionId]);
}
