"use client";
// Next / back that feel instant. The wanted slide shows at once; the server is told in
// the background, one request at a time, and only the newest wish is sent, so tapping
// → five times quickly lands on the fifth slide with at most two round trips. Students
// get the change through the session broadcast as soon as the server has it.
//
// The wish is kept until the teacher's own copy of the lesson state shows that slide.
// (Dropping it as soon as the request returned let a refresh that was already on its
// way, with the old slide, put the old slide back on the teacher's screen while the
// students had moved on.) If something else moves the lesson, it is dropped a few
// seconds after it was sent.
import { useCallback, useEffect, useReducer } from "react";
import { rpc } from "./rpc";

type Nav = { want: number | null; inflight: boolean; sentAt: number; count: number; listeners: Set<() => void> };
const navs = new Map<string, Nav>();
const GIVE_UP_MS = 6000;

function navFor(sessionId: string): Nav {
  let n = navs.get(sessionId);
  if (!n) { n = { want: null, inflight: false, sentAt: 0, count: 0, listeners: new Set() }; navs.set(sessionId, n); }
  return n;
}
const notify = (n: Nav) => n.listeners.forEach((f) => f());

async function pump(sessionId: string, reload: () => Promise<unknown>, onError: (e: unknown) => void) {
  const n = navFor(sessionId);
  if (n.inflight || n.want === null) return;
  const target = n.want;
  n.inflight = true;
  try {
    await rpc("session_control", { p_session: sessionId, p_action: "goto", p_args: { slide: target } });
    n.sentAt = Date.now();
    // Fetch the new state now; the broadcast may bring it sooner. Either clears the wish.
    void reload().catch(() => {});
  } catch (e) {
    if (n.want === target) n.want = null;
    onError(e);
  } finally {
    n.inflight = false;
    // The teacher pressed again meanwhile: send the newest.
    if (n.want !== null && n.want !== target) void pump(sessionId, reload, onError);
    notify(n);
  }
}

export type SlideNav = ReturnType<typeof useSlideNav>;

/**
 * The slide to show (the teacher's newest wish, else the server's) and the moves.
 * `current` is the server's slide; `count` the number of slides (0 if unknown here:
 * another view of the same session that knows it shares it).
 */
export function useSlideNav(sessionId: string, current: number, count: number, reload: () => Promise<unknown>, onError: (e: unknown) => void) {
  const [tick, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const n = navFor(sessionId);
    n.listeners.add(rerender);
    return () => { n.listeners.delete(rerender); };
  }, [sessionId]);
  useEffect(() => { if (count > 0) navFor(sessionId).count = count; }, [sessionId, count]);

  // Drop the wish once the server's slide matches it, or a while after it was sent.
  useEffect(() => {
    const n = navFor(sessionId);
    if (n.want === null || n.inflight || !n.sentAt) return;
    if (current === n.want) { n.want = null; notify(n); return; }
    const t = window.setTimeout(() => {
      if (n.want !== null && !n.inflight && Date.now() - n.sentAt >= GIVE_UP_MS) { n.want = null; notify(n); }
    }, Math.max(0, GIVE_UP_MS - (Date.now() - n.sentAt)));
    return () => window.clearTimeout(t);
  }, [sessionId, current, tick]);

  const want = navFor(sessionId).want;
  const total = count || navFor(sessionId).count;
  const slide = want ?? current;
  const go = useCallback((to: number) => {
    const n = navFor(sessionId);
    const known = count || n.count;
    const last = known > 0 ? known - 1 : Number.MAX_SAFE_INTEGER;
    const target = Math.max(0, Math.min(to, last));
    if (target === (n.want ?? current)) return;
    n.want = target;
    n.sentAt = 0;
    notify(n);
    void pump(sessionId, reload, onError);
  }, [sessionId, count, current, reload, onError]);
  return {
    slide,
    pending: want !== null,
    go,
    next: () => go(slide + 1),
    prev: () => go(slide - 1),
    atStart: slide <= 0,
    atEnd: total > 0 && slide >= total - 1
  };
}
