import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { messageForError, statusForError, type RpcError } from "./errors";
import { createClient } from "./supabase/server";
import { createAnonClient } from "./supabase/service";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import type { Profile } from "./types";

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data ?? null, init);
}

export function fail(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function fromError(err: RpcError) {
  const status = statusForError(err);
  if (status >= 500) logServerError(err.message ?? "Unknown database error", undefined, "api");
  return fail(status, messageForError(err), err.code ? { code: err.code } : undefined);
}

/** Record an unexpected server-side failure in the platform error log. Never throws. */
export function logServerError(message: string, stack?: string, source: "server" | "api" = "server", url?: string) {
  try {
    void createAnonClient().rpc("log_error", {
      p_source: source, p_message: message.slice(0, 2000), p_stack: stack?.slice(0, 8000) ?? null,
      p_url: url ?? null, p_user_agent: null, p_release: process.env.NEXT_PUBLIC_RELEASE ?? null
    }).then(() => {}, () => {});
  } catch { /* logging must never break a request */ }
}

/** Wrap a Route Handler so uncaught exceptions are logged and answered with a clean 500. */
export function withErrorLog<A extends unknown[]>(handler: (req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    try {
      return await handler(req, ...rest);
    } catch (e) {
      const err = e as Error;
      logServerError(`${err.name ?? "Error"}: ${err.message ?? String(e)}`, err.stack, "api", new URL(req.url).pathname);
      return fail(500, "Something went wrong. The problem has been reported.");
    }
  };
}

/** Call an RPC and translate DB errors into HTTP responses. */
export async function callRpc(sb: SupabaseClient, fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) return { response: fromError(error), data: null };
  return { response: null, data };
}

/** Resolve the signed-in user's profile for a Route Handler. */
export async function requireProfile(roles?: Profile["role"][]) {
  const sb = await createClient();
  // Verified JWT claims (local check with asymmetric keys); an unreachable Auth server is a 503, not a sign-out.
  const { data: claims, error } = await sb.auth.getClaims();
  if (error && isAuthRetryableFetchError(error)) return { sb, me: null, response: fail(503, "Sign-in service temporarily unreachable. Try again.") } as const;
  const uid = claims?.claims?.sub;
  if (!uid) return { sb, me: null, response: fail(401, "Sign in first.") } as const;
  const { data } = await sb.from("users").select("id,tenant_id,email,full_name,nickname,role,status").eq("id", uid).maybeSingle();
  const me = data as Profile | null;
  if (!me || me.status !== "active") return { sb, me: null, response: fail(403, "No active SwiftCipher profile.") } as const;
  if (roles && !roles.includes(me.role)) return { sb, me: null, response: fail(403, "You don't have access to this.") } as const;
  return { sb, me, response: null } as const;
}

export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = 1_000_000): Promise<T | null> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) return null;
  try {
    const text = await req.text();
    if (text.length > maxBytes) return null;
    return (text ? JSON.parse(text) : {}) as T;
  } catch {
    return null;
  }
}
