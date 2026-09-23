import { callRpc, fail, ok } from "@/lib/api";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient, hasServiceRole } from "@/lib/supabase/service";

/** Super admin: delete any user's data and their login. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const r = await callRpc(createClient(), "sa_delete_user", { p_user: params.id });
  if (r.response) return r.response;
  if (!hasServiceRole()) return fail(500, "User data deleted, but the login remains: SUPABASE_SERVICE_ROLE_KEY is not set.");
  const { error } = await createServiceClient().auth.admin.deleteUser(params.id);
  if (error && !/not found/i.test(error.message)) return fail(500, `Data deleted, but the login could not be removed: ${error.message}`);
  return ok({ deleted: true });
}
