import { callRpc, fail, ok, requireProfile, withErrorLog } from "@/lib/api";
import { createServiceClient, hasServiceRole } from "@/lib/supabase/service";

/**
 * Deletion workflow (§20): delete_user_data() authorises the caller as an
 * admin of the same tenant, audits, and removes the tenant profile + data;
 * then the auth identity is removed with the service role.
 */
export const DELETE = withErrorLog(async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb, response } = await requireProfile(["school_admin", "platform_admin"]);
  if (response) return response;
  const r = await callRpc(sb, "delete_user_data", { p_user: id });
  if (r.response) return r.response;
  if (hasServiceRole()) {
    const { error } = await createServiceClient().auth.admin.deleteUser(id);
    if (error && !/not found/i.test(error.message)) return fail(500, `Profile deleted, but the login could not be removed: ${error.message}`);
  }
  return ok({ deleted: true, auth_removed: hasServiceRole() });
});
