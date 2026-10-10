import { createServiceClient, hasServiceRole } from "./supabase/service";

// Token buckets. allowShared() keeps them in the database (migration 1070), so a limit
// holds across every app server; allow() keeps them in this server's memory, for hot
// paths where a database round trip per request costs too much (device heartbeats).
const buckets = new Map<string, { tokens: number; at: number }>();

export function allow(key: string, perMinute: number): boolean {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: perMinute, at: now };
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60_000) * perMinute);
  b.at = now;
  if (b.tokens < 1) { buckets.set(key, b); return false; }
  b.tokens -= 1;
  buckets.set(key, b);
  if (buckets.size > 50_000) buckets.clear();
  return true;
}

/** The caller's address as seen by the hosting proxy (first x-forwarded-for hop). */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

/**
 * The same limit, shared by every app server through the database. Falls back to this
 * server's memory without a service key, or if the database can't be reached, so a
 * hiccup never locks people out.
 */
export async function allowShared(key: string, perMinute: number): Promise<boolean> {
  if (!hasServiceRole()) return allow(key, perMinute);
  try {
    const { data, error } = await createServiceClient().rpc("rate_allow", { p_key: key.slice(0, 200), p_per_minute: perMinute });
    if (error || typeof data !== "boolean") return allow(key, perMinute);
    return data;
  } catch {
    return allow(key, perMinute);
  }
}
