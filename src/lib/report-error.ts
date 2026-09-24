"use client";
// Sends browser errors to the platform error log (public.log_error), which the
// super admin reviews at /super/errors. Deduplicated and capped per page load.
import { createClient } from "@/lib/supabase/client";

const seen = new Set<string>();
let sent = 0;
const MAX_PER_PAGE = 20;

// Noise we can't act on (browser extensions, cancelled fetches on navigation).
const IGNORE = [/ResizeObserver loop/, /Non-Error promise rejection captured/, /AbortError/, /Load failed/, /chrome-extension:\/\//];

export function reportError(err: unknown, context?: string) {
  if (typeof window === "undefined") return;
  const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err));
  const message = `${context ? `[${context}] ` : ""}${e.name}: ${e.message}`.slice(0, 2000);
  if (IGNORE.some((re) => re.test(message) || re.test(e.stack ?? ""))) return;
  if (seen.has(message) || sent >= MAX_PER_PAGE) return;
  seen.add(message); sent++;
  void createClient().rpc("log_error", {
    p_source: "client",
    p_message: message,
    p_stack: (e.stack ?? "").slice(0, 8000),
    p_url: window.location.pathname + window.location.search,
    p_user_agent: navigator.userAgent.slice(0, 500),
    p_release: process.env.NEXT_PUBLIC_RELEASE ?? null
  }).then(() => {}, () => {});
}
