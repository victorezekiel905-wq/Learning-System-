"use client";
// Private Realtime channels ("Broadcast from Database", migration 0760).
// The database sends a tiny signal ("state", "roster", "alert", ...) on topics
// such as session:<id>, staff:<id>, user:<id>, thread:<id>, board:<id>, game:<id>;
// pages refetch only when told, instead of polling every few seconds.
// Channel access is checked server-side by app.can_listen / app.can_send.
import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";

let authed: Promise<void> | null = null;
/** Private channels need the user's JWT on the socket (once per tab, refreshed on auth changes). */
export function ensureRealtimeAuth() {
  if (!authed) {
    const sb = createClient();
    authed = sb.auth.getSession().then(async ({ data }) => {
      if (data.session) await sb.realtime.setAuth(data.session.access_token);
    });
    sb.auth.onAuthStateChange((_e, session) => { if (session) void sb.realtime.setAuth(session.access_token); });
  }
  return authed;
}

export async function openChannel(topic: string, self = false): Promise<RealtimeChannel> {
  await ensureRealtimeAuth();
  return createClient().channel(topic, { config: { private: true, broadcast: { self, ack: false } } });
}

/**
 * Calls `onSignal` when any of `events` arrives on `topic` (debounced, so a
 * burst of changes causes one refetch). `minGapMs` caps how often it can fire.
 */
export function useSignal(topic: string | null, events: string[], onSignal: (event: string) => void, opts: { debounceMs?: number; minGapMs?: number } = {}) {
  const cb = useRef(onSignal);
  cb.current = onSignal;
  const key = events.join(",");
  useEffect(() => {
    if (!topic) return;
    let ch: RealtimeChannel | null = null;
    let cancelled = false;
    let timer: number | undefined;
    let last = 0;
    let pending = "";
    const fire = (event: string) => {
      pending = event;
      window.clearTimeout(timer);
      const wait = Math.max(opts.debounceMs ?? 300, (opts.minGapMs ?? 0) - (Date.now() - last));
      timer = window.setTimeout(() => { last = Date.now(); cb.current(pending); }, wait);
    };
    void openChannel(topic).then((c) => {
      if (cancelled) return;
      ch = c;
      for (const e of key.split(",")) ch.on("broadcast", { event: e }, () => fire(e));
      ch.subscribe();
    });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (ch) void createClient().removeChannel(ch);
    };
  }, [topic, key, opts.debounceMs, opts.minGapMs]);
}
