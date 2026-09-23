// Assigns THE platform super admin (there can only be one).
//   node scripts/set-super-admin.mjs you@example.com
//   node scripts/set-super-admin.mjs other@example.com --replace   # hand it over
// Needs SUPABASE_SERVICE_ROLE_KEY in .env.local. The account must already
// exist (sign up in the app first).
import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const email = (process.argv[2] ?? "").trim().toLowerCase();
const replace = process.argv.includes("--replace");
if (!email.includes("@")) { console.error("Usage: node scripts/set-super-admin.mjs <email> [--replace]"); process.exit(2); }
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let user = null;
for (let page = 1; !user; page++) {
  const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 });
  if (error) { console.error(error.message); process.exit(1); }
  user = data.users.find((u) => u.email?.toLowerCase() === email) ?? null;
  if (data.users.length < 200) break;
}
if (!user) { console.error(`No account with email ${email}. Sign up in the app first.`); process.exit(1); }

const { data: current, error: readErr } = await sb.from("platform_admins").select("user_id").maybeSingle();
if (readErr) { console.error(`${readErr.message}\nHave you run supabase/updates/2026-09-23_super_admin_branding.sql?`); process.exit(1); }
if (current?.user_id === user.id) { console.log(`${email} is already the super admin.`); process.exit(0); }
if (current && !replace) { console.error("A super admin already exists. Re-run with --replace to hand the role over."); process.exit(1); }

const { error } = await sb.from("platform_admins").upsert({ singleton: true, user_id: user.id, assigned_at: new Date().toISOString() }, { onConflict: "singleton" });
if (error) { console.error(error.message); process.exit(1); }
await sb.from("platform_audit").insert({ actor_id: null, action: current ? "super_admin.replaced" : "super_admin.assigned", target_type: "user", target_id: user.id });
console.log(`${email} is now the SwiftCipher super admin. Open /super after signing in.`);
