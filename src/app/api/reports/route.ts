import { callRpc, fail, ok, readJson, requireProfile, withErrorLog } from "@/lib/api";
import { createServiceClient, hasServiceRole } from "@/lib/supabase/service";

/**
 * POST {kind, class_id?, days?} → stores a report snapshot and returns its id.
 * Data is computed by RLS-bound RPCs as the caller; only the final insert into
 * `reports` (which has no client insert policy) uses the service role.
 */
export const POST = withErrorLog(async function POST(req: Request) {
  const { sb, me, response } = await requireProfile(["teacher", "school_admin", "it_admin", "platform_admin"]);
  if (response) return response;
  const body = await readJson<{ kind?: string; class_id?: string; days?: number }>(req);
  if (!body?.kind) return fail(400, "kind is required.");
  const days = Math.min(Math.max(Number(body.days ?? 30), 1), 365);

  let payload: unknown, title: string, scopeType: string | null = null, scopeId: string | null = null;
  if (body.kind === "class_analytics") {
    const r = await callRpc(sb, "class_analytics", { p_class: body.class_id, p_days: days });
    if (r.response) return r.response;
    payload = r.data; scopeType = "class"; scopeId = body.class_id!;
    const { data: c } = await sb.from("classes").select("name").eq("id", body.class_id!).single();
    title = `Class analytics: ${c?.name ?? ""} (${days} days)`;
  } else if (body.kind === "attendance") {
    const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
    const { data, error } = await sb.from("attendance").select("date,status,source,users(full_name)").eq("class_id", body.class_id!).gte("date", since).order("date");
    if (error) return fail(403, "You can't read that class's attendance.");
    payload = { rows: data };
    scopeType = "class"; scopeId = body.class_id!;
    title = `Attendance register (${days} days)`;
  } else if (body.kind === "tenant_overview") {
    const r = await callRpc(sb, "tenant_overview", {});
    if (r.response) return r.response;
    payload = r.data; title = "School overview";
  } else {
    return fail(400, "Unknown report kind.");
  }

  if (!hasServiceRole()) return ok({ id: null, payload, note: "SUPABASE_SERVICE_ROLE_KEY not set; report not stored." });
  const { data, error } = await createServiceClient().from("reports")
    .insert({ tenant_id: me.tenant_id, kind: body.kind, title, scope_type: scopeType, scope_id: scopeId, payload, created_by: me.id })
    .select("id").single();
  if (error) return fail(500, error.message);
  return ok({ id: data.id });
});
