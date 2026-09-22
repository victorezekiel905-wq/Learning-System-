"use client";
import { useCallback, useEffect, useState } from "react";
import { ActionError, rpc } from "./rpc";

/**
 * Low-bandwidth design (§33) / failure scenario (§30): answers are written to
 * localStorage first and flushed when the network is back, so a dropped
 * connection never loses submitted work.
 */
type Job = { id: string; fn: string; args: Record<string, unknown>; at: number };
const KEY = "sc:answer-queue:v1";

function read(): Job[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as Job[]; } catch { return []; }
}
function write(jobs: Job[]) {
  try { localStorage.setItem(KEY, JSON.stringify(jobs)); } catch { /* storage full/blocked */ }
  window.dispatchEvent(new Event("sc-queue"));
}

function isNetworkError(e: unknown) {
  return !(e instanceof ActionError) || /fetch|network|Failed to/i.test(e.message);
}

let flushing = false;
export async function flushQueue(onRejected?: (job: Job, message: string) => void) {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    for (const job of read()) {
      try {
        await rpc(job.fn, job.args);
        write(read().filter((j) => j.id !== job.id));
      } catch (e) {
        if (isNetworkError(e)) break;              // still offline: keep order, retry later
        write(read().filter((j) => j.id !== job.id)); // server rejected: drop and report
        onRejected?.(job, e instanceof Error ? e.message : "Rejected");
      }
    }
  } finally {
    flushing = false;
  }
}

/** Try now; if offline, queue it. Returns the RPC result or { queued: true }. */
export async function sendOrQueue<T>(fn: string, args: Record<string, unknown>): Promise<T | { queued: true }> {
  if (navigator.onLine) {
    try {
      return await rpc<T>(fn, args);
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    }
  }
  // Replace an older queued answer to the same question.
  const key = JSON.stringify([fn, args.p_attempt, args.p_question]);
  const jobs = read().filter((j) => JSON.stringify([j.fn, j.args.p_attempt, j.args.p_question]) !== key);
  write([...jobs, { id: crypto.randomUUID(), fn, args, at: Date.now() }]);
  return { queued: true };
}

export function useOfflineQueue(onRejected?: (message: string) => void) {
  const [pending, setPending] = useState(0);
  const refresh = useCallback(() => setPending(read().length), []);
  useEffect(() => {
    refresh();
    const flush = () => void flushQueue((_, m) => onRejected?.(m)).then(refresh);
    window.addEventListener("online", flush);
    window.addEventListener("sc-queue", refresh);
    const id = window.setInterval(flush, 15_000);
    flush();
    return () => { window.removeEventListener("online", flush); window.removeEventListener("sc-queue", refresh); window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { pending, flush: () => flushQueue().then(refresh) };
}
