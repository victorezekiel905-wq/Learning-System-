import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Completes Supabase PKCE OAuth and returns the user to the role-aware dashboard. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  if (!code) return NextResponse.redirect(new URL(`/login?error=missing_oauth_code`, url));

  const sb = createClient();
  const { error } = await sb.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error.message)}`, url));
  return NextResponse.redirect(new URL(next, url));
}

function safeNext(value: string | null): string {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}
