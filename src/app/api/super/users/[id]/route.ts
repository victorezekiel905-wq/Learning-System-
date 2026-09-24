import { callRpc, fail, ok, withErrorLog } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient, hasServiceRole } from "@/lib/supabase/service";

/** Super admin: delete any user's data and their login. */
export const DELETE = withErrorLog(async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await callRpc(await createClient(), "sa_delete_user", { p_user: id });
  if (r.response) return r.response;
  if (!hasServiceRole()) return fail(500, "User data deleted, but the login remains: SUPABASE_SERVICE_ROLE_KEY is not set.");
  const { error } = await createServiceClient().auth.admin.deleteUser(id);
  if (error && !/not found/i.test(error.message)) return fail(500, `Data deleted, but the login could not be removed: ${error.message}`);
  return ok({ deleted: true });
});
