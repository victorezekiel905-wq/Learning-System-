// Combines supabase/migrations/*.sql (in order) into supabase/setup.sql so the
// whole database can be created by pasting one file into the Supabase SQL Editor.
//   node scripts/build-setup-sql.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = "supabase/migrations";
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const header = `-- =============================================================================
-- SwiftCipher: complete database setup (generated; do not edit by hand)
--
-- HOW TO USE
--   1. Supabase dashboard -> SQL Editor -> New query.
--   2. Paste this whole file and click Run. It takes 10-30 seconds.
--   3. Run it ONCE, on an EMPTY project. It is not safe to re-run.
--
-- Generated from ${files.length} files in supabase/migrations by
-- scripts/build-setup-sql.mjs. If you use the Supabase CLI instead, run
-- \`supabase db push\`; do not do both.
-- =============================================================================

`;

const body = files
  .map((f) => `-- >>>>>>>>>>>>>>>>>>>> ${f} >>>>>>>>>>>>>>>>>>>>\n${readFileSync(join(dir, f), "utf8").trim()}\n`)
  .join("\n");

const footer = `
-- =============================================================================
-- Done. Quick check: this should return 5 plans.
-- =============================================================================
select code, name from public.plans order by sort;
`;

writeFileSync("supabase/setup.sql", header + body + footer);
console.log(`supabase/setup.sql written from ${files.length} migrations`);
