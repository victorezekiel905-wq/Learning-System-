import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Reads .env.local when present (local runs); CI passes real env vars.
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
export const canSeed = Boolean(SUPABASE_URL && ANON && SERVICE);

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
export const admin = (): SupabaseClient => createClient(SUPABASE_URL, SERVICE, opts);

export type TestUser = { id: string; email: string; password: string; client: SupabaseClient };

/** A confirmed throwaway account, signed in with an RLS-bound client. */
export async function makeUser(tag: string, role: string, created: { users: string[] }): Promise<TestUser> {
  const email = `e2e-${tag}-${role}@swiftcipher.test`;
  const password = randomBytes(12).toString("base64url") + "A1!";
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `E2E ${role}` } });
  if (error) throw error;
  created.users.push(data.user.id);
  const client = createClient(SUPABASE_URL, ANON, opts);
  const { error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw e2;
  return { id: data.user.id, email, password, client };
}

/**
 * Puts the user's existing session into a browser context exactly as @supabase/ssr
 * stores it after a sign-in (cookie sb-<ref>-auth-token, "base64-" JSON, chunked
 * over ~3 KB). Avoids a fresh sign-in per test, which Supabase rate-limits.
 */
export async function sessionCookies(u: TestUser, baseURL: string) {
  const { data } = await u.client.auth.getSession();
  if (!data.session) throw new Error("no session");
  const ref = new URL(SUPABASE_URL).hostname.split(".")[0];
  const name = `sb-${ref}-auth-token`;
  const value = "base64-" + Buffer.from(JSON.stringify(data.session)).toString("base64url");
  const url = new URL(baseURL);
  const common = { domain: url.hostname, path: "/", httpOnly: false, secure: url.protocol === "https:", sameSite: "Lax" as const };
  const MAX = 3180;
  if (value.length <= MAX) return [{ name, value, ...common }];
  const out = [];
  for (let i = 0; i * MAX < value.length; i++) out.push({ name: `${name}.${i}`, value: value.slice(i * MAX, (i + 1) * MAX), ...common });
  return out;
}

export async function call<T = unknown>(c: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** True when the database has the schema this build expects (the update SQL has been applied). */
export async function dbReady(minSchema = "0760"): Promise<boolean> {
  if (!SUPABASE_URL || !ANON) return false;
  // Retries: a single dropped request must not silently skip the live tests.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { data, error } = await createClient(SUPABASE_URL, ANON, opts).rpc("health");
      if (!error) return !!data && String((data as { schema?: string }).schema ?? "") >= minSchema;
    } catch { /* network blip */ }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

export async function cleanup(created: { users: string[]; tenants: string[] }) {
  const a = admin();
  for (const id of created.tenants) await a.from("tenants").delete().eq("id", id);
  for (const id of created.users) await a.auth.admin.deleteUser(id);
}
