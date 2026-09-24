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

export async function call<T = unknown>(c: SupabaseClient, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** True when the database has the schema this build expects (the update SQL has been applied). */
export async function dbReady(minSchema = "0760"): Promise<boolean> {
  if (!SUPABASE_URL || !ANON) return false;
  const { data } = await createClient(SUPABASE_URL, ANON, opts).rpc("health");
  return !!data && String((data as { schema?: string }).schema ?? "") >= minSchema;
}

export async function cleanup(created: { users: string[]; tenants: string[] }) {
  const a = admin();
  for (const id of created.tenants) await a.from("tenants").delete().eq("id", id);
  for (const id of created.users) await a.auth.admin.deleteUser(id);
}
