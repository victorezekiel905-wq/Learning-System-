"use client";
// Next / back that feel instant. The wanted slide shows at once; the server is told in
// the background, one request at a time, and only the newest wish is sent, so tapping
// → five times quickly lands on the fifth slide with at most two round trips. Students
// get the change through the session broadcast as soon as the server has it.
import { useCallback, useEffect, useReducer } from "react";
import { rpc } from "./rpc";

type Nav = { want: number | null; inflight: boolean; count: number; listeners: Set<() => void> };
const navs = new Map<string, Nav>();

function navFor(sessionId: string): Nav {
  let n = navs.get(sessionId);
  if (!n) { n = { want: null, inflight: false, count: 0, listeners: new Set() }; navs.set(sessionId, n); }
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
    if (n.want === target) await reload().catch(() => {});
  } catch (e) {
    if (n.want === target) n.want = null;
    onError(e);
  } finally {
    n.inflight = false;
    // The teacher pressed again meanwhile: send the newest. Otherwise the reloaded state now has it.
    if (n.want !== null && n.want !== target) void pump(sessionId, reload, onError);
    else n.want = null;
    notify(n);
  }
}

/**
 * The slide to show (the teacher's newest wish, else the server's) and the moves.
 * `current` is the server's slide; `count` the number of slides (0 if unknown here:
 * another view of the same session that knows it shares it).
 */
export type SlideNav = ReturnType<typeof useSlideNav>;

export function useSlideNav(sessionId: string, current: number, count: number, reload: () => Promise<unknown>, onError: (e: unknown) => void) {
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const n = navFor(sessionId);
    n.listeners.add(rerender);
    return () => { n.listeners.delete(rerender); };
  }, [sessionId]);
  useEffect(() => { if (count > 0) navFor(sessionId).count = count; }, [sessionId, count]);
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
