import "server-only";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "./supabase/server";
import type { Me, Role } from "./types";

/** me() for Server Components, memoised per request. */
export const getMe = cache(async (): Promise<Me | null> => {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.rpc("me");
  return (data as Me | null) ?? { profile: null, email: user.email ?? undefined };
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
  return { me: me as Me & { profile: NonNullable<Me["profile"]> }, sb: createClient() };
}

/** The platform console. Anyone else gets a plain 404, so it isn't even discoverable. */
export async function requireSuperAdmin() {
  const me = await getMe();
  if (!me?.super_admin) notFound();
  return { me, sb: createClient() };
}
