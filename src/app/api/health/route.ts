import { NextResponse } from "next/server";
import { LEGAL_ENV } from "@/lib/legal";
import { createAnonClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

/**
 * Uptime check: 200 when the app can reach the database, 503 otherwise.
 * Point an uptime monitor (and the GitHub "health" workflow) at /api/health.
 */
export async function GET() {
  const started = Date.now();
  const release = process.env.NEXT_PUBLIC_RELEASE ?? "dev";
  const missing = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_APP_URL"]
    .filter((k) => !process.env[k]);
  const warnings = LEGAL_ENV.filter((k) => !process.env[k]);
  try {
    const { data, error } = await createAnonClient().rpc("health");
    if (error) throw error;
    return NextResponse.json({ ok: missing.length === 0, db: "up", schema: data?.schema ?? null, release, missing_config: missing, missing_legal_details: warnings, ms: Date.now() - started },
      { status: missing.length ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ ok: false, db: "down", release, error: (e as Error).message ?? "unreachable", ms: Date.now() - started },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
