import "server-only";
import { NextResponse } from "next/server";
import { messageForError, statusForError } from "./errors";
import { createAnonClient } from "./supabase/service";
import { allow, clientIp } from "./rate-limit";

/**
 * Gateway for the browser extension (§21). The extension never holds a user
 * session: each call carries (device_id, secret), which the SECURITY DEFINER
 * RPCs verify against the stored sha256. These routes only translate HTTP
 * to RPC, rate-limit, and add CORS for the extension origin.
 */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store"
};

export function preflight() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS });
}


export function appHost(): string | null {
  try { return process.env.NEXT_PUBLIC_APP_URL ? new URL(process.env.NEXT_PUBLIC_APP_URL).hostname : null; } catch { return null; }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function deviceCall(
  req: Request,
  opts: { fn: string; perMinute: number; maxBytes?: number; requireDevice?: boolean; map: (body: Record<string, unknown>) => Record<string, unknown> }
) {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > (opts.maxBytes ?? 20_000)) return reply({ error: "Payload too large." }, 413);
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    if (text.length > (opts.maxBytes ?? 20_000)) return reply({ error: "Payload too large." }, 413);
    body = JSON.parse(text || "{}");
  } catch {
    return reply({ error: "Invalid JSON." }, 400);
  }
  const ip = clientIp(req);
  const key = opts.requireDevice === false ? `ip:${ip}` : `dev:${String(body.device_id ?? ip)}`;
  if (opts.requireDevice !== false && !UUID.test(String(body.device_id ?? ""))) return reply({ error: "device_id required." }, 400);
  if (!allow(`${opts.fn}:${key}`, opts.perMinute)) return reply({ error: "Too many requests." }, 429);

  const { data, error } = await createAnonClient().rpc(opts.fn, opts.map(body));
  if (error) return reply({ error: messageForError(error), code: error.code }, statusForError(error));
  return reply(data ?? { ok: true });
}

export const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : null);
export const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);
