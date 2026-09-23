import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/utils";

const TYPES = new Set<EmailOtpType>(["signup", "invite", "magiclink", "recovery", "email_change", "email"]);

/**
 * Email links (confirm sign-up, invite, password reset) using Supabase's
 * token-hash flow. Unlike the PKCE code flow, this works when the link is
 * opened in a different browser or device from the one that started it.
 * Requires the email templates in docs/SETUP.md §1.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const fallback = type === "recovery" ? "/account?reset=1" : "/onboarding";
  const next = safeNext(url.searchParams.get("next"), fallback);

  if (!tokenHash || !type || !TYPES.has(type)) {
    return NextResponse.redirect(new URL("/login?error=This%20link%20is%20incomplete.%20Request%20a%20new%20one.", url));
  }
  const { error } = await createClient().auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    const msg = /expired|invalid/i.test(error.message)
      ? "This link has expired or was already used. Sign in, or request a new link."
      : error.message;
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, url));
  }
  return NextResponse.redirect(new URL(next, url));
}
