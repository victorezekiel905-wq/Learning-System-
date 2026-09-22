import { createClient as createBaseClient } from "@supabase/supabase-js";

export function createServiceClient(): any {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.includes("replace-with-")) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured. Service-role operations " +
      "are unavailable in this environment; use the RLS-bound server client instead."
    );
  }
  return createBaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
