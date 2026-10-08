import "server-only";
import { createClient as createBaseClient, type SupabaseClient } from "@supabase/supabase-js";

/** The service key as configured, without the quotes, spaces or "Bearer " that copying sometimes adds. */
function serviceKey(): string | null {
  const raw = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!raw) return null;
  return raw.trim().replace(/^["']|["']$/g, "").replace(/^Bearer\s+/i, "").trim() || null;
}

/**
 * Service-role client: bypasses RLS. Only for trusted server work that has
 * already authorised the caller (auth-user deletion, billing webhooks,
 * admin invites). Never import from client code.
 */
export function createServiceClient(): SupabaseClient {
  const key = serviceKey();
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured on the server.");
  return createBaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

/** Anonymous client for the device-agent gateway (RPCs authenticate by device secret). */
export function createAnonClient(): SupabaseClient {
  return createBaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export function hasServiceRole(): boolean {
  return Boolean(serviceKey());
}

const KEY_HELP = "Copy the service_role (or secret) key from Supabase: Project Settings → API Keys, paste it into SUPABASE_SERVICE_ROLE_KEY on Render (no quotes or spaces), and redeploy.";

/** Turns Supabase's refusal of the service key into what to do about it. */
export function explainServiceError(message: string | undefined): string {
  const m = message ?? "";
  if (/bearer token|not allowed|invalid api key|invalid jwt|jwt|signature|unauthori[sz]ed|no api key/i.test(m)) {
    return `The server's Supabase service key was refused. ${KEY_HELP} (Super admin → Server check tests it.)`;
  }
  return m || "Supabase refused the request.";
}

export type ServiceKeyCheck = { ok: boolean; kind: string; problem: string | null; detail: string | null };

/** Tests the service key without revealing it: its type, its project, and a real admin call. */
export async function checkServiceKey(): Promise<ServiceKeyCheck> {
  const key = serviceKey();
  if (!key) return { ok: false, kind: "missing", problem: `SUPABASE_SERVICE_ROLE_KEY is not set. ${KEY_HELP}`, detail: null };
  const raw = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const cleaned = raw !== key ? "Extra quotes or spaces around the key were ignored; tidy the setting on Render when you can." : null;
  let kind = "unknown format";
  let problem: string | null = null;
  if (key.startsWith("sb_secret_")) kind = "secret key (new format)";
  else if (key.startsWith("sb_publishable_")) { kind = "publishable key"; problem = `This is the publishable (public) key, not the secret key. ${KEY_HELP}`; }
  else if (key.split(".").length === 3) {
    try {
      const claims = JSON.parse(Buffer.from(key.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as { role?: string; ref?: string };
      kind = `legacy key, role "${claims.role ?? "?"}"`;
      const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://x").hostname.split(".")[0];
      if (claims.role !== "service_role") problem = `This is the ${claims.role ?? "wrong"} key, not service_role. ${KEY_HELP}`;
      else if (claims.ref && ref && claims.ref !== ref) problem = `This key belongs to another Supabase project (${claims.ref}), not ${ref}. ${KEY_HELP}`;
    } catch { kind = "unreadable key"; }
  }
  if (problem) return { ok: false, kind, problem, detail: cleaned };
  const { error } = await createServiceClient().auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) return { ok: false, kind, problem: `Supabase refused the key (${error.message}). It may be an old key that was rotated. ${KEY_HELP}`, detail: cleaned };
  return { ok: true, kind, problem: null, detail: cleaned };
}
