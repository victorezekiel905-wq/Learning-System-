import { callRpc, fail, ok, requireProfile, withErrorLog } from "@/lib/api";
import { createServiceClient, hasServiceRole } from "@/lib/supabase/service";
import { newPassword } from "@/lib/server/student-accounts";

export const runtime = "nodejs";

/** A new starting password for a school-made student login (the student chooses their own at next sign-in). */
export const POST = withErrorLog(async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb, response } = await requireProfile(["teacher", "school_admin", "platform_admin"]);
  if (response) return response;
  if (!hasServiceRole()) return fail(500, "Resetting passwords needs SUPABASE_SERVICE_ROLE_KEY on the server.");
  const r = await callRpc(sb, "prepare_password_reset", { p_student: id });
  if (r.response) return r.response;
  const password = newPassword();
  const { error } = await createServiceClient().auth.admin.updateUserById(id, { password });
  if (error) return fail(500, error.message);
  return ok({ login: (r.data as { login_name: string }).login_name, password });
});
