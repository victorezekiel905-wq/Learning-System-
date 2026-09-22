import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** GET — environment alert feed for the session. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data, error } = await sb.from("environment_events")
    .select("id,kind,url,severity,acknowledged,ts,student_id,users(full_name)")
    .eq("session_id", params.id)
    .order("ts", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

/** PATCH — teacher acknowledges an alert. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.event_id) return NextResponse.json({ error: "event_id required" }, { status: 400 });
  const { data, error } = await sb.from("environment_events")
    .update({ acknowledged: true, acknowledged_by: user.id })
    .eq("id", body.event_id).eq("session_id", params.id)
    .select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
