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

// Channels being removed, by topic. supabase-js hands back the existing channel
// for a topic, so reopening before a removal finishes would return the dying one.
const closing = new Map<string, Promise<unknown>>();

/**
 * A channel for sending (e.g. a student's own screen frames). Only use this for
 * topics nothing else in the tab listens to; listeners use `listen()`.
 * Close it with `closeChannel()`.
 */
export async function openChannel(topic: string, self = false): Promise<RealtimeChannel> {
  await ensureRealtimeAuth();
  await closing.get(topic);
  return createClient().channel(topic, { config: { private: true, broadcast: { self, ack: false } } });
}

/** Removes a channel; a later openChannel() for the same topic waits for this to finish. */
export function closeChannel(topic: string, channel: RealtimeChannel) {
  const done = createClient().removeChannel(channel).catch(() => {}).finally(() => {
    if (closing.get(topic) === done) closing.delete(topic);
  });
  closing.set(topic, done);
  return done;
}

// ---------------------------------------------------------------------------
// Shared listeners. supabase-js returns the SAME channel object for the same
// topic, so two components listening to one topic share it, and one of them
// removing it would silently cut the other off. The registry keeps one channel
// per topic, counts listeners, and removes it only when the last one leaves
// (after a short grace period, so a quick remount reuses the live channel).
// ---------------------------------------------------------------------------
type Handler = (event: string, payload: unknown) => void;
type Entry = { channel: RealtimeChannel | null; handlers: Set<Handler>; closeTimer?: number; opening?: Promise<void> };
const registry = new Map<string, Entry>();

/** Listen to every broadcast on `topic`. Returns a function that stops listening. */
export function listen(topic: string, handler: Handler): () => void {
  let entry = registry.get(topic);
  if (!entry) {
    const e: Entry = { channel: null, handlers: new Set() };
    e.opening = ensureRealtimeAuth().then(() => closing.get(topic)).then(() => {
      const ch = createClient().channel(topic, { config: { private: true, broadcast: { self: false, ack: false } } });
      ch.on("broadcast", { event: "*" }, (msg: { event?: string; payload?: unknown }) => {
        for (const h of [...e.handlers]) h(msg.event ?? "", msg.payload);
      }).subscribe();
      e.channel = ch;
    });
    registry.set(topic, e);
    entry = e;
  }
  window.clearTimeout(entry.closeTimer);
  entry.handlers.add(handler);
  const current = entry;
  return () => {
    current.handlers.delete(handler);
    if (current.handlers.size) return;
    current.closeTimer = window.setTimeout(() => {
      if (current.handlers.size || registry.get(topic) !== current) return;
      registry.delete(topic);
      void current.opening?.then(() => { if (current.channel) void closeChannel(topic, current.channel); });
    }, 2000);
  };
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
    const wanted = new Set(key.split(","));
    let timer: number | undefined;
    let last = 0;
    let pending = "";
    const stop = listen(topic, (event) => {
      if (!wanted.has(event)) return;
      pending = event;
      window.clearTimeout(timer);
      const wait = Math.max(opts.debounceMs ?? 300, (opts.minGapMs ?? 0) - (Date.now() - last));
      timer = window.setTimeout(() => { last = Date.now(); cb.current(pending); }, wait);
    });
    return () => { window.clearTimeout(timer); stop(); };
  }, [topic, key, opts.debounceMs, opts.minGapMs]);
}
