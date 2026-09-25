// Best-effort, per-server-instance token buckets. Serverless instances don't share
// memory, so this slows abuse rather than guaranteeing a global cap; the database
// and Supabase Auth enforce the hard limits.
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
