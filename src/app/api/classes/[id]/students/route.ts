import { callRpc, fail, ok, readJson, requireProfile, withErrorLog } from "@/lib/api";
import { createServiceClient, explainServiceError, hasServiceRole } from "@/lib/supabase/service";
import { loginEmail } from "@/lib/student-login";
import { newPassword, usernameBase, usernameCandidate } from "@/lib/server/student-accounts";

export const runtime = "nodejs";
export const maxDuration = 300;

type In = { full_name?: string; email?: string; admission_no?: string };
type AddedRow = { name: string; login: string | null; password: string | null; status: string; ok: boolean };

/**
 * Staff add students to a class (one, or a list from a CSV or Excel file).
 * Each student gets a login made by the school: their email if given, or a
 * username, with a starting password they must change at first sign-in.
 * A student who already has an account in the school is just added to the class.
 */
export const POST = withErrorLog(async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sb, response } = await requireProfile(["teacher", "school_admin", "platform_admin"]);
  if (response) return response;
  const body = await readJson<{ students?: In[] }>(req, 1_000_000);
  const list = (body?.students ?? []).slice(0, 301);
  if (!list.length) return fail(400, "Add at least one student.");
  if (list.length > 300) return fail(400, "Add up to 300 students at a time.");
  const access = await callRpc(sb, "class_access", { p_class: id });
  if (access.response || !(access.data as { manage?: boolean } | null)?.manage) return fail(404, "Class not found.");
  if (!hasServiceRole()) return fail(500, "Adding students needs SUPABASE_SERVICE_ROLE_KEY on the server.");
  const admin = createServiceClient();

  const rows: AddedRow[] = [];
  for (const s of list) {
    const name = (s.full_name ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
    const email = (s.email ?? "").trim().toLowerCase() || null;
    const admission = (s.admission_no ?? "").trim().slice(0, 40) || null;
    if (!name) { rows.push({ name: "(no name)", login: email, password: null, status: "Name missing", ok: false }); continue; }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { rows.push({ name, login: email, password: null, status: "Email address isn't valid", ok: false }); continue; }

    if (email) {
      const existing = await sb.rpc("add_existing_student", { p_class: id, p_email: email });
      if (!existing.error && existing.data) { rows.push({ name, login: email, password: null, status: "Already had an account: added to the class", ok: true }); continue; }
    }

    const password = newPassword();
    let uid: string | null = null, username: string | null = null, authEmail = email, problem = "";
    if (email) {
      const made = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
      uid = made.data.user?.id ?? null;
      if (!uid) problem = /already|registered|exists/i.test(made.error?.message ?? "")
        ? "This email already has a SwiftCipher login. Ask the student to join with the class code instead."
        : explainServiceError(made.error?.message);
    } else {
      const base = usernameBase(name);
      for (let attempt = 0; attempt < 8 && !uid; attempt++) {
        const candidate = usernameCandidate(base);
        const { data: taken } = await admin.from("users").select("id").eq("login_name", candidate).maybeSingle();
        if (taken) continue;
        const made = await admin.auth.admin.createUser({ email: loginEmail(candidate), password, email_confirm: true, user_metadata: { full_name: name } });
        if (made.data.user) { uid = made.data.user.id; username = candidate; authEmail = loginEmail(candidate); }
        else if (!/already|registered|exists/i.test(made.error?.message ?? "")) { problem = explainServiceError(made.error?.message); break; }
      }
      if (!uid && !problem) problem = "Couldn't find a free username. Try again.";
    }
    if (!uid) { rows.push({ name, login: email, password: null, status: problem, ok: false }); continue; }

    const added = await sb.rpc("add_managed_student", { p_class: id, p_user: uid, p_email: authEmail, p_name: name, p_login: username, p_admission: admission });
    if (added.error) {
      await admin.auth.admin.deleteUser(uid).catch(() => {});
      rows.push({ name, login: username ?? email, password: null, status: added.error.message, ok: false });
      continue;
    }
    rows.push({ name, login: username ?? email, password, status: "Added", ok: true });
  }
  return ok({ rows });
});
