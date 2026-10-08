import { cookies } from "next/headers";
import { callRpc, fail, ok, withErrorLog } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient, hasServiceRole } from "@/lib/supabase/service";

const RETURN_COOKIE = "sc_support_return";

/**
 * Super admin: "Open as admin". Signs this browser into the school's support
 * account (a school admin called "SwiftCipher support"), creating it the first
 * time. The way back to the super admin's own session is kept in an httpOnly
 * cookie for two hours (see /api/support/exit).
 */
export const POST = withErrorLog(async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!hasServiceRole()) return fail(500, "Opening a school needs SUPABASE_SERVICE_ROLE_KEY on the server.");
  const sb = await createClient();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return fail(401, "Sign in first.");

  // Checks the caller is the super admin and records the visit in the platform log.
  const acct = await callRpc(sb, "sa_support_account", { p_tenant: id });
  if (acct.response) return acct.response;
  const info = acct.data as { user_id: string | null; email: string; status: string };
  if (info.status !== "active") return fail(409, "This school is suspended. Restore it first, then open it.");

  const admin = createServiceClient();
  if (!info.user_id) {
    let uid: string | undefined;
    const made = await admin.auth.admin.createUser({ email: info.email, email_confirm: true, user_metadata: { full_name: "SwiftCipher support" } });
    uid = made.data.user?.id;
    if (!uid) {
      // Created on an earlier attempt that didn't finish: find it.
      for (let page = 1; page <= 50 && !uid; page++) {
        const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        uid = data.users.find((u) => u.email?.toLowerCase() === info.email)?.id;
        if (data.users.length < 1000) break;
      }
    }
    if (!uid) return fail(500, made.error?.message ?? "Couldn't create the support account.");
    const reg = await callRpc(sb, "sa_register_support", { p_tenant: id, p_user: uid });
    if (reg.response) return reg.response;
  }

  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: info.email });
  if (error || !link.properties?.hashed_token) return fail(500, error?.message ?? "Couldn't sign in to the school.");

  (await cookies()).set(RETURN_COOKIE, JSON.stringify({ rt: session.refresh_token, tenant: id }), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 2 * 3600
  });
  // Swap this browser's session for the support account's (sets the auth cookies).
  const { error: vErr } = await sb.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (vErr) return fail(500, vErr.message);
  return ok({ redirect: "/admin" });
});
