import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { messageForError, statusForError, type RpcError } from "./errors";
import { createClient } from "./supabase/server";
import type { Profile } from "./types";

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data ?? null, init);
}

export function fail(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function fromError(err: RpcError) {
  return fail(statusForError(err), messageForError(err), err.code ? { code: err.code } : undefined);
}

/** Call an RPC and translate DB errors into HTTP responses. */
export async function callRpc(sb: SupabaseClient, fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) return { response: fromError(error), data: null };
  return { response: null, data };
}

/** Resolve the signed-in user's profile for a Route Handler. */
export async function requireProfile(roles?: Profile["role"][]) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { sb, me: null, response: fail(401, "Sign in first.") } as const;
  const { data } = await sb.from("users").select("id,tenant_id,email,full_name,nickname,role,status").eq("id", user.id).maybeSingle();
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
