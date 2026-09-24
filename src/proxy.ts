import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/super", "/teacher", "/student", "/parent", "/admin", "/guard", "/messages", "/notifications", "/present", "/onboarding", "/dashboard", "/account"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(toSet: { name: string; value: string; options: CookieOptions }[]) {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        }
      }
    }
  );

  // Refreshes the session cookie when needed and verifies the JWT (locally with
  // asymmetric signing keys); must run before any redirect decision.
  const { data, error } = await supabase.auth.getClaims();
  // If the Auth server can't be reached, don't bounce a signed-in user to the
  // sign-in page; the page itself re-checks and shows a retryable error instead.
  if (error && isAuthRetryableFetchError(error)) return response;
  const signedIn = !!data?.claims?.sub;
  const path = request.nextUrl.pathname;
  if (!signedIn && PROTECTED.some((p) => path === p || path.startsWith(p + "/"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  // Skip static assets and the device-agent gateway (it authenticates by device secret).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|api/devices|api/health|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
