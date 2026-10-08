import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/utils";
import { parseWho, whoForRole, wrongTabMessage } from "@/lib/who";

/**
 * Completes OAuth/SSO sign-ins and older PKCE-style email links. Email links
 * should use /auth/confirm (token hash), which works across browsers.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  const linkError = url.searchParams.get("error_description");
  if (linkError) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(linkError)}`, url));
  if (!code) return NextResponse.redirect(new URL("/login?error=Missing%20sign-in%20code", url));

  const sb = await createClient();
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) {
    // The link was opened in a different browser from the one that started the
    // flow. Supabase has already verified the email by this point, so the user
    // can simply sign in; onboarding resumes from their sign-up details.
    if (/code verifier|code_verifier|pkce/i.test(error.message)) {
      return NextResponse.redirect(new URL(`/login?notice=confirmed&next=${encodeURIComponent(next)}`, url));
    }
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url));
  }
  // Signed in with Google or Microsoft from the student, parent or staff tab: the account must match it.
  const who = parseWho(url.searchParams.get("as"));
  if (who) {
    const { data } = await sb.rpc("me");
    const m = data as { profile?: { role?: string } | null; super_admin?: boolean } | null;
    const actual = m?.profile ? whoForRole(m.profile.role) : m?.super_admin ? "staff" : null;
    if (actual && actual !== who) {
      await sb.auth.signOut({ scope: "local" });
      return NextResponse.redirect(new URL(`/login?as=${who}&error=${encodeURIComponent(wrongTabMessage(actual))}`, url));
    }
  }
  return NextResponse.redirect(new URL(next, url));
}
