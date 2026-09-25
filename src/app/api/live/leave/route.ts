import { callRpc, fail, ok, readJson, requireProfile, withErrorLog } from "@/lib/api";

/**
 * Sent by the student's lesson page with navigator.sendBeacon when the tab or
 * browser is closed, so the teacher is told instantly ("Closed the lesson")
 * instead of after the page stops reporting.
 */
export const POST = withErrorLog(async function POST(req: Request) {
  const { sb, me, response } = await requireProfile(["student"]);
  if (response) return response;
  const body = await readJson<{ session_id?: string }>(req, 1_000);
  const session = body?.session_id;
  if (!session || !/^[0-9a-f-]{36}$/i.test(session)) return fail(400, "session_id required");
  const r = await callRpc(sb, "leave_session", { p_session: session });
  if (r.response) return r.response;
  return ok({ left: true, student: me.id });
});
