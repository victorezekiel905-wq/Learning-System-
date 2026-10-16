"use client";
// The teacher's live lesson state (Present and the control room), kept in step with
// what students see.
//
// Students' screens move on the lesson's broadcast, which carries the new slide, phase
// and open activity. The teacher's screens used to wait for the full lesson state
// (roster, alerts, results, rankings): when that request was slow or failed, the
// teacher's screen hung while the students moved on. Now the same broadcast, and the
// server's own reply to each button (Next, Start, Reveal…), update the teacher's screen
// at once; the full state follows, with retries, for everything else.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionState } from "@/components/live/types";
import { createClient } from "./supabase/client";
import { messageForError } from "./errors";
import { useLoader } from "./hooks";
import { listen } from "./realtime";

/** The compact state that travels with every change (app.session_changed). */
export type Pulse = { v: number; phase?: string; status?: string; slide?: number; activity?: string | null; mode?: string;
  /** Only in a button's reply (1170): shared results, the revealed activity and the board. */
  responses_visible?: boolean; revealed?: string | null; show_leaderboard?: boolean;
  leaderboard?: SessionState["session"]["leaderboard"] };

/** The full state with a newer pulse laid on top. Results of a slide we have left are dropped. */
export function withPulse(state: SessionState | null, pulse: Pulse | null): SessionState | null {
  if (!state || !pulse) return state;
  const s = state.session;
  if (pulse.v <= (s.state_version ?? 0)) return state;
  const slideChanged = pulse.slide !== undefined && pulse.slide !== s.current_slide;
  const activityChanged = pulse.activity !== undefined && pulse.activity !== s.active_activity_id;
  const moved = slideChanged || activityChanged;
  return {
    ...state,
    session: {
      ...s,
      state_version: pulse.v,
      phase: (pulse.phase ?? s.phase) as SessionState["session"]["phase"],
      status: pulse.status ?? s.status,
      mode: pulse.mode ?? s.mode,
      current_slide: pulse.slide ?? s.current_slide,
      active_activity_id: pulse.activity !== undefined ? pulse.activity : s.active_activity_id,
      // Changing slide hides shared results on the server too (1010).
      responses_visible: pulse.responses_visible ?? (slideChanged ? false : s.responses_visible),
      show_leaderboard: pulse.show_leaderboard ?? s.show_leaderboard,
      leaderboard: pulse.leaderboard !== undefined ? (pulse.leaderboard ?? s.leaderboard) : s.leaderboard
    },
    // Revealed: the answers show at once, with the counts we have; the refresh updates them.
    activity: moved ? null : state.activity && pulse.revealed !== undefined && pulse.revealed === state.activity.activity.id
      ? { ...state.activity, revealed: true } : state.activity,
    timer: moved ? null : state.timer
  };
}

const TIMEOUT_MS = 10_000;

export function useLiveState(sessionId: string, opts: { intervalMs: number }) {
  const okAt = useRef(0);
  const q = useLoader<SessionState>(async () => {
    // A request that stalls is given up on, so the next one can go.
    const { data, error } = await createClient().rpc("teacher_session_state", { p_session: sessionId }).abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    if (error) throw new Error(messageForError(error));
    okAt.current = Date.now();
    return data as SessionState;
  }, [sessionId], { intervalMs: opts.intervalMs });

  // Newest compact state: from the lesson broadcast, or from a button's reply.
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const take = useCallback((p: unknown) => {
    const x = p as Partial<Pulse> | null;
    if (!x || typeof x.v !== "number") return;
    setPulse((f) => (f && f.v >= x.v! ? f : (x as Pulse)));
  }, []);
  useEffect(() => listen(`session:${sessionId}`, (event, payload) => { if (event === "state") take(payload); }), [sessionId, take]);

  // Full refresh, tried up to three times.
  const reloadRaw = q.reload;
  const refresh = useCallback(async () => {
    for (let i = 0; i < 3; i++) {
      const before = okAt.current;
      await reloadRaw();
      if (okAt.current > before) return;
      await new Promise((r) => setTimeout(r, 700 * (i + 1)));
    }
  }, [reloadRaw]);

  // A pulse newer than the full state: fetch the rest (results, board, roster).
  const version = q.data?.session.state_version ?? 0;
  useEffect(() => {
    if (!pulse || pulse.v <= version) return;
    const t = window.setTimeout(() => void refresh(), 150);
    return () => window.clearTimeout(t);
  }, [pulse, version, refresh]);

  const data = useMemo(() => withPulse(q.data, pulse), [q.data, pulse]);
  return { data, error: q.error, loading: q.loading, reload: refresh, take };
}
