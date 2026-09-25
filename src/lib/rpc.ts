"use client";
import { createClient } from "./supabase/client";
import { isNetworkMessage, messageForError } from "./errors";

/** ActionError.code for a request that never reached the server (offline, dropped connection). */
export const NETWORK = "NETWORK";

export class ActionError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

/** Browser-side RPC call; throws ActionError with a user-facing message. */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await createClient().rpc(fn, args);
  if (error) throw new ActionError(messageForError(error), error.code || (isNetworkMessage(error.message) ? NETWORK : undefined));
  return data as T;
}

/** JSON fetch against our own API routes; throws ActionError on non-2xx. */
export async function api<T = unknown>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { ...(init?.json !== undefined ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ActionError((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong.";
}

/**
 * Unwraps a supabase-js table result ({ data, error }), throwing on error.
 * Table writes return errors instead of throwing, so without this a failed
 * insert/update/delete (e.g. denied by a policy) would pass silently.
 */
export function must<T>(res: { data: T; error: { message: string; code?: string; details?: string; hint?: string } | null }): T {
  if (res.error) throw new ActionError(messageForError(res.error), res.error.code || (isNetworkMessage(res.error.message) ? NETWORK : undefined));
  return res.data;
}
