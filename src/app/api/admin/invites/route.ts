import { callRpc, fail, ok, readJson, requireProfile } from "@/lib/api";
import { createServiceClient, hasServiceRole } from "@/lib/supabase/service";

/** Create a staff/parent invite; email it through Supabase Auth when the service role is configured. */
export async function POST(req: Request) {
  const { sb, response } = await requireProfile(["school_admin", "platform_admin", "teacher"]);
  if (response) return response;
  const body = await readJson<{ role?: string; email?: string | null; student_id?: string | null; class_id?: string | null; max_uses?: number }>(req);
  if (!body?.role) return fail(400, "role is required.");
  const email = body.email?.trim().toLowerCase() || null;
  const r = await callRpc(sb, "create_invite", {
    p_role: body.role, p_email: email, p_student: body.student_id ?? null, p_class: body.class_id ?? null,
    p_days: 14, p_max_uses: email ? 1 : Math.min(Math.max(Number(body.max_uses ?? 1), 1), 1000)
  });
  if (r.response) return r.response;
  const code = (r.data as { code: string }).code;

  let emailed = false;
  if (email && hasServiceRole()) {
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
    const { error } = await createServiceClient().auth.admin.inviteUserByEmail(email, {
      data: { intent: "code", code }, redirectTo: `${origin}/auth/callback?next=/onboarding`
    });
    emailed = !error;
  }
  return ok({ code, emailed });
}
