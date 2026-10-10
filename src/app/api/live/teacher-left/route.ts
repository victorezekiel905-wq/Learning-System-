import { callRpc, fail, ok, readJson, requireProfile, withErrorLog } from "@/lib/api";
import { TEACHERS } from "@/lib/session";

/**
 * Sent by the teacher's live pages with navigator.sendBeacon when the tab or
 * browser is closed. The lesson ends 1 minute later unless the teacher comes
 * back (a refresh), even without "End session" (migration 1020).
 */
export const POST = withErrorLog(async function POST(req: Request) {
  const { sb, response } = await requireProfile(TEACHERS);
  if (response) return response;
  const body = await readJson<{ session_id?: string }>(req, 1_000);
  const session = body?.session_id;
  if (!session || !/^[0-9a-f-]{36}$/i.test(session)) return fail(400, "session_id required");
  const r = await callRpc(sb, "teacher_here", { p_session: session, p_here: false });
  if (r.response) return r.response;
  return ok({ left: true });
});
