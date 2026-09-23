import { callRpc, fail, ok, readJson } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient, hasServiceRole } from "@/lib/supabase/service";

/** Super admin: delete a school and its members' login accounts. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const sb = createClient();
  const body = await readJson<{ confirm_name?: string }>(req);
  // sa_delete_tenant verifies the caller is the super admin (404 otherwise).
  const r = await callRpc(sb, "sa_delete_tenant", { p_tenant: params.id, p_confirm_name: body?.confirm_name ?? "" });
  if (r.response) return r.response;
  const ids = (r.data as string[]) ?? [];
  let removed = 0;
  if (hasServiceRole()) {
    const admin = createServiceClient();
    for (const id of ids) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (!error) removed++;
    }
  }
  if (ids.length && !hasServiceRole()) return fail(500, "School deleted, but login accounts remain: SUPABASE_SERVICE_ROLE_KEY is not set.");
  return ok({ deleted: true, logins_removed: removed });
}
