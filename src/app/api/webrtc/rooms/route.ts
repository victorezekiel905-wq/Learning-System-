import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// §3.7 — WebRTC signalling room lifecycle: open / list / close.
// The browser uses the room id as the only signalling handle; recordings are
// handled in-browser via MediaRecorder and posted back to /api/reports later.
export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.session_id) return NextResponse.json({ error: "session_id required" }, { status: 400 });

  const { data: me } = await sb.from("users").select("tenant_id").eq("id", user.id).maybeSingle();
  if (!me) return NextResponse.json({ error: "profile not set up" }, { status: 400 });

  // Close any prior open rooms on the same session before opening a fresh one.
  await sb.from("rtc_rooms").update({ state: "closed" })
    .eq("session_id", body.session_id).eq("state", "open");
  const { data, error } = await sb.from("rtc_rooms").insert({
    tenant_id: me.tenant_id,
    session_id: body.session_id,
    host_user_id: user.id,
    state: "open"
  }).select("id,session_id,host_user_id,created_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function GET(req: NextRequest) {
  const sb = createClient();
  const session = req.nextUrl.searchParams.get("session_id");
  if (!session) return NextResponse.json({ error: "session_id required" }, { status: 400 });
  const { data } = await sb.from("rtc_rooms")
    .select("id,host_user_id,state,created_at").eq("session_id", session)
    .order("created_at", { ascending: false }).limit(5);
  return NextResponse.json(data ?? []);
}

export async function DELETE(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.room_id) return NextResponse.json({ error: "room_id required" }, { status: 400 });
  const { data, error } = await sb.from("rtc_rooms").update({ state: "closed" })
    .eq("id", body.room_id).select("id,state").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
