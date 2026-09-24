import { fail, ok, readJson, requireProfile, withErrorLog } from "@/lib/api";
import { createServiceClient, hasServiceRole } from "@/lib/supabase/service";

type Row = { email: string; full_name: string; code: string | null; status: string };

/** Parse a small CSV (quoted fields supported). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows;
}

/**
 * CSV roster import (§19): one single-use student invite per row, bound to the
 * row's email. Optionally emails a Supabase invite that lands on /join?code=.
 */
export const POST = withErrorLog(async function POST(req: Request) {
  const { sb, response } = await requireProfile(["teacher", "school_admin", "platform_admin"]);
  if (response) return response;
  const body = await readJson<{ class_id?: string; csv?: string; send_email?: boolean }>(req, 500_000);
  if (!body?.class_id || !body.csv) return fail(400, "class_id and csv are required.");

  const table = parseCsv(body.csv);
  if (table.length < 2) return fail(400, "The CSV needs a header row and at least one student.");
  if (table.length > 1001) return fail(400, "Import up to 1000 students at a time.");
  const header = table[0]!.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (name: string) => header.indexOf(name);
  const iEmail = col("email"), iFull = col("full_name"), iFirst = col("first_name"), iLast = col("last_name");
  if (iEmail < 0) return fail(400, "Missing an 'email' column.");

  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  const service = body.send_email && hasServiceRole() ? createServiceClient() : null;
  const rows: Row[] = [];
  let emailed = 0;

  for (const r of table.slice(1)) {
    const email = (r[iEmail] ?? "").trim().toLowerCase();
    const full = (iFull >= 0 ? r[iFull] : [r[iFirst] ?? "", r[iLast] ?? ""].join(" "))?.trim() || email.split("@")[0] || "";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { rows.push({ email, full_name: full, code: null, status: "invalid email" }); continue; }
    const { data, error } = await sb.rpc("create_invite", { p_role: "student", p_email: email, p_class: body.class_id, p_days: 30 });
    if (error) { rows.push({ email, full_name: full, code: null, status: error.message }); continue; }
    const code = (data as { code: string }).code;
    let status = "invite created";
    if (service) {
      const { error: mailErr } = await service.auth.admin.inviteUserByEmail(email, {
        data: { full_name: full, intent: "code", code },
        redirectTo: `${origin}/auth/callback?next=/onboarding`
      });
      if (mailErr) status = /already/i.test(mailErr.message) ? "has an account — share the code" : `email failed: ${mailErr.message}`;
      else { status = "emailed"; emailed++; }
    }
    rows.push({ email, full_name: full, code, status });
  }
  return ok({ rows, emailed });
});
