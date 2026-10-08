import { callRpc, fail, ok, readJson, requireProfile, withErrorLog } from "@/lib/api";
import { createServiceClient, hasServiceRole } from "@/lib/supabase/service";

export const runtime = "nodejs";

/** School admins: delete a student's account and everything with it, after typing their name. */
export const DELETE = withErrorLog(async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb, response } = await requireProfile(["school_admin", "platform_admin"]);
  if (response) return response;
  if (!hasServiceRole()) return fail(500, "Deleting accounts needs SUPABASE_SERVICE_ROLE_KEY on the server.");
  const body = await readJson<{ confirm_name?: string }>(req);
  const check = await callRpc(sb, "delete_student_check", { p_student: id, p_confirm_name: body?.confirm_name ?? "" });
  if (check.response) return check.response;
  const { error } = await createServiceClient().auth.admin.deleteUser(id);
  if (error) return fail(500, error.message);
  return ok({ deleted: true });
});
