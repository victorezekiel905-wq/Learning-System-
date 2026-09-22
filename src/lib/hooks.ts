"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "./supabase/client";
import { messageForError } from "./errors";

type QueryState<T> = { data: T | null; error: string | null; loading: boolean; reload: () => Promise<void> };

/**
 * Load an RPC (or any async loader) and optionally poll it. Polling pauses
 * while the tab is hidden to save bandwidth (§33 low-bandwidth design).
 */
export function useLoader<T>(loader: () => Promise<T>, deps: unknown[], opts: { intervalMs?: number; enabled?: boolean } = {}): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const enabled = opts.enabled ?? true;

  const reload = useCallback(async () => {
    try {
      const next = await loaderRef.current();
      setData(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    void reload();
    if (!opts.intervalMs) return;
    const tick = () => { if (document.visibilityState === "visible") void reload(); };
    const id = window.setInterval(tick, opts.intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, opts.intervalMs]);

  return { data, error, loading, reload };
}

export function useRpc<T>(fn: string, args: Record<string, unknown>, deps: unknown[], opts?: { intervalMs?: number; enabled?: boolean }) {
  return useLoader<T>(async () => {
    const { data, error } = await createClient().rpc(fn, args);
    if (error) throw new Error(messageForError(error));
    return data as T;
  }, deps, opts);
}

/**
 * Re-run `onChange` when rows change in any of the given tables (Supabase
 * Realtime respects RLS). Debounced so bursts cause one refetch.
 */
export function useRealtime(key: string, subs: { table: string; filter?: string }[], onChange: () => void, enabled = true) {
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    if (!enabled) return;
    const sb = createClient();
    let timer: number | undefined;
    const fire = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => cb.current(), 250);
    };
    let channel = sb.channel(`rt:${key}`);
    for (const s of subs) {
      channel = channel.on("postgres_changes" as never, { event: "*", schema: "public", table: s.table, filter: s.filter } as never, fire);
    }
    channel.subscribe();
    return () => {
      window.clearTimeout(timer);
      void sb.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);
}

/** Tracks navigator.onLine plus a rough connection quality (§33 bandwidth indicator). */
export function useNetwork() {
  const [online, setOnline] = useState(true);
  const [quality, setQuality] = useState<"good" | "slow" | "offline">("good");
  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: { effectiveType?: string; saveData?: boolean; addEventListener?: (e: string, f: () => void) => void; removeEventListener?: (e: string, f: () => void) => void } }).connection;
    const update = () => {
      const on = navigator.onLine;
      setOnline(on);
      const slow = conn?.saveData || ["slow-2g", "2g", "3g"].includes(conn?.effectiveType ?? "");
      setQuality(!on ? "offline" : slow ? "slow" : "good");
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    conn?.addEventListener?.("change", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      conn?.removeEventListener?.("change", update);
    };
  }, []);
  return { online, quality };
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}
