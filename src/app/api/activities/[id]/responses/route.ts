import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** POST — student submits a response; auto-grading happens server-side (RPC). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.session_id || body.response === undefined) {
    return NextResponse.json({ error: "session_id, response required" }, { status: 400 });
  }
  const { data, error } = await sb.rpc("submit_activity_response", {
    p_activity: params.id,
    p_session: body.session_id,
    p_response: body.response,
    p_elapsed_ms: body.elapsed_ms ?? 0
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

/** GET — teacher: response counts + accuracy for this activity. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data, error } = await sb.from("activity_responses")
    .select("id,response,correct,awarded,elapsed_ms,submitted_at")
    .eq("activity_id", params.id)
    .order("submitted_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const rows = (data ?? []) as { correct: boolean }[];
  return NextResponse.json({
    responses: data ?? [],
    total: rows.length,
    correct: rows.filter(r => r.correct).length,
    accuracy: rows.length ? Math.round((rows.filter(r => r.correct).length / rows.length) * 100) : 0
  });
}
