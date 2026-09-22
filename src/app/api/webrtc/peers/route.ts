import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Me = { id: string; tenant_id: string; full_name: string | null; role: string };

export async function GET(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const roomId = req.nextUrl.searchParams.get("room_id");
  if (!roomId) return NextResponse.json({ error: "room_id required" }, { status: 400 });

  const { data: me } = await sb.from("users").select("id,tenant_id").eq("id", user.id).maybeSingle();
  if (!me) return NextResponse.json({ error: "profile not set up" }, { status: 400 });

  const { data, error } = await sb.from("rtc_peers")
    .select("id,room_id,user_id,display_name,role,state,media,joined_at,last_seen_at")
    .eq("room_id", roomId)
    .eq("tenant_id", me.tenant_id)
    .order("last_seen_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const now = Date.now();
  const peers = (data ?? []).filter((peer: { state: string; last_seen_at: string }) => {
    if (peer.state !== "joined") return false;
    return now - new Date(peer.last_seen_at).getTime() < 120_000;
  });

  return NextResponse.json(peers);
}

export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json();
  if (!body.room_id) return NextResponse.json({ error: "room_id required" }, { status: 400 });

  const [{ data: me }, { data: room }] = await Promise.all([
    sb.from("users").select("id,tenant_id,full_name,role").eq("id", user.id).maybeSingle(),
    sb.from("rtc_rooms").select("id,tenant_id,state").eq("id", body.room_id).maybeSingle()
  ]);

  if (!me) return NextResponse.json({ error: "profile not set up" }, { status: 400 });
  if (!room || room.state !== "open") return NextResponse.json({ error: "room not open" }, { status: 404 });
  if (room.tenant_id !== (me as Me).tenant_id) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const payload = {
    tenant_id: (me as Me).tenant_id,
    room_id: room.id,
    user_id: user.id,
    display_name: body.display_name || (me as Me).full_name || user.email || "Participant",
    role: body.role || (me as Me).role,
    state: "joined",
    media: body.media && typeof body.media === "object" ? body.media : { audio: true, video: true },
    last_seen_at: new Date().toISOString()
  };

  const { data, error } = await sb.from("rtc_peers")
    .upsert(payload, { onConflict: "room_id,user_id" })
    .select("id,room_id,user_id,display_name,role,state,media,joined_at,last_seen_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json();
  if (!body.peer_id) return NextResponse.json({ error: "peer_id required" }, { status: 400 });
  const update: Record<string, unknown> = { last_seen_at: new Date().toISOString(), state: "joined" };
  if (body.media && typeof body.media === "object") update.media = body.media;

  const { data, error } = await sb.from("rtc_peers")
    .update(update)
    .eq("id", body.peer_id)
    .eq("user_id", user.id)
    .select("id,room_id,user_id,display_name,role,state,media,joined_at,last_seen_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json();
  if (!body.peer_id) return NextResponse.json({ error: "peer_id required" }, { status: 400 });

  const { data, error } = await sb.from("rtc_peers")
    .update({ state: "left", last_seen_at: new Date().toISOString() })
    .eq("id", body.peer_id)
    .eq("user_id", user.id)
    .select("id,state,last_seen_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
