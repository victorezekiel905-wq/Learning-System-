import { cookies } from "next/headers";
import { ok, withErrorLog } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";

const RETURN_COOKIE = "sc_support_return";

/** Leaves a school opened with "Open as admin": back to the super admin's own session. */
export const POST = withErrorLog(async function POST() {
  const jar = await cookies();
  const raw = jar.get(RETURN_COOKIE)?.value;
  jar.delete(RETURN_COOKIE);
  const sb = await createClient();
  await sb.auth.signOut({ scope: "local" });
  let back: { rt?: string; tenant?: string } = {};
  try { back = JSON.parse(raw ?? "{}"); } catch { /* ignore */ }
  if (!back.rt) return ok({ redirect: "/login?as=staff" });
  const { error } = await sb.auth.refreshSession({ refresh_token: back.rt });
  if (error) return ok({ redirect: "/login?as=staff" });
  return ok({ redirect: back.tenant ? `/super/schools/${back.tenant}` : "/super" });
});
