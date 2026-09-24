import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";
import type { Me, Role } from "./types";

/**
 * me() for Server Components, memoised per request.
 * Identity comes from getClaims(): the session JWT is verified locally (no call to the
 * Auth server when the project uses asymmetric signing keys). A network failure is
 * retried once and then shown as an error page. It is never treated as "signed out",
 * so a Wi-Fi blip can't throw a teacher out of a live lesson.
 */
export const getMe = cache(async (): Promise<Me | null> => {
  const sb = await createClient();
  let claims = await sb.auth.getClaims();
  if (claims.error && isAuthRetryableFetchError(claims.error)) claims = await sb.auth.getClaims();
  if (claims.error && isAuthRetryableFetchError(claims.error)) {
    throw new Error("The sign-in service is temporarily unreachable. Please try again in a moment.");
  }
  const c = claims.data?.claims;
  if (!c?.sub) return null;
  let me = await sb.rpc("me");
  if (me.error) me = await sb.rpc("me");
  if (me.error) throw new Error("Couldn't load your profile. Please try again in a moment.");
  return (me.data as Me | null) ?? { profile: null, email: (c.email as string | undefined) ?? undefined };
});

export const STAFF: Role[] = ["teacher", "school_admin", "it_admin", "platform_admin"];
export const TEACHERS: Role[] = ["teacher", "school_admin", "platform_admin"];
export const ADMINS: Role[] = ["school_admin", "platform_admin"];
export const IT: Role[] = ["it_admin", "school_admin", "platform_admin"];

export function homeFor(role: Role | undefined): string {
  switch (role) {
    case "student": return "/student";
    case "parent": return "/parent";
    case "it_admin": return "/guard";
    case "teacher":
    case "school_admin":
    case "platform_admin": return "/teacher";
    default: return "/onboarding";
  }
}

/** Gate a page: signed in, has a profile, school active, and (optionally) one of the roles. */
export async function requireRole(roles?: Role[]) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!me.profile) redirect(me.super_admin ? "/super" : "/onboarding");
  if (me.profile.status !== "active") redirect("/login?error=suspended");
  if (me.tenant?.status === "suspended") redirect(me.super_admin ? "/super" : "/login?error=school_suspended");
  if (roles && !roles.includes(me.profile.role)) redirect(homeFor(me.profile.role));
  return { me: me as Me & { profile: NonNullable<Me["profile"]> }, sb: await createClient() };
}

/** The platform console. Anyone else gets a plain 404, so it isn't even discoverable. */
export async function requireSuperAdmin() {
  const me = await getMe();
  if (!me?.super_admin) notFound();
  return { me, sb: await createClient() };
}
