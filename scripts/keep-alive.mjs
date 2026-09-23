// Pings your Supabase project so the free tier doesn't pause it for inactivity.
// Makes one tiny read through the REST API (the public plans catalogue).
//
//   node scripts/keep-alive.mjs            # reads .env.local
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/keep-alive.mjs
//
// Run it automatically with .github/workflows/keep-alive.yml, or a local
// scheduler (cron / Windows Task Scheduler) every few days.
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const key = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_ANON_KEY (or the NEXT_PUBLIC_ versions in .env.local).");
  process.exit(2);
}

for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const res = await fetch(`${url}/rest/v1/plans?select=code&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000)
    });
    if (res.ok) {
      console.log(`${new Date().toISOString()} Supabase is awake (HTTP ${res.status}).`);
      process.exit(0);
    }
    console.error(`Attempt ${attempt}: HTTP ${res.status} ${await res.text()}`);
  } catch (e) {
    console.error(`Attempt ${attempt}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 10_000 * attempt));
}
console.error("Keep-alive failed. If the project is already paused, restore it from the Supabase dashboard.");
process.exit(1);
