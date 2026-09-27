/**
 * The site's public address for links in emails, redirects and set-up
 * instructions. NEXT_PUBLIC_APP_URL wins, except when it is a development
 * value (localhost) while the site is being reached on a real domain: then a
 * forgotten setting would send staff and parents to localhost links.
 */
export function appOrigin(requestOrigin?: string | null): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "") || null;
  const local = (u: string | null | undefined) => !!u && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(u);
  if (env && !(local(env) && requestOrigin && !local(requestOrigin))) return env;
  return requestOrigin?.replace(/\/+$/, "") || env || "";
}
