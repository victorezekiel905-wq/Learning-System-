import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type SignalKind = "offer" | "answer" | "ice" | "bye";

export async function GET(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const roomId = req.nextUrl.searchParams.get("room_id");
  const peerId = req.nextUrl.searchParams.get("peer_id");
  if (!roomId || !peerId) return NextResponse.json({ error: "room_id and peer_id required" }, { status: 400 });

  const { data: peer } = await sb.from("rtc_peers")
    .select("id,user_id,room_id")
    .eq("id", peerId)
    .eq("room_id", roomId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!peer) return NextResponse.json({ error: "peer not found" }, { status: 404 });

  const { data, error } = await sb.from("rtc_signals")
    .select("id,from_peer_id,to_peer_id,kind,payload,created_at")
    .eq("room_id", roomId)
    .eq("to_peer_id", peerId)
    .is("consumed_at", null)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json(data ?? []);
}

export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json();
  if (!body.room_id || !body.to_peer_id || !body.kind)
    return NextResponse.json({ error: "room_id, to_peer_id, kind required" }, { status: 400 });
  if (!["offer", "answer", "ice", "bye"].includes(body.kind))
    return NextResponse.json({ error: "invalid signal kind" }, { status: 400 });

  const { data: fromPeer } = await sb.from("rtc_peers")
    .select("id,tenant_id,room_id,user_id")
    .eq("room_id", body.room_id)
    .eq("user_id", user.id)
    .eq("state", "joined")
    .maybeSingle();
  if (!fromPeer) return NextResponse.json({ error: "sender peer not found" }, { status: 404 });

  const { data: toPeer } = await sb.from("rtc_peers")
    .select("id,room_id,tenant_id,state")
    .eq("id", body.to_peer_id)
    .maybeSingle();
  if (!toPeer || toPeer.room_id !== body.room_id || toPeer.state !== "joined")
    return NextResponse.json({ error: "recipient peer not found" }, { status: 404 });

  const { data, error } = await sb.from("rtc_signals").insert({
    tenant_id: fromPeer.tenant_id,
    room_id: body.room_id,
    from_peer_id: fromPeer.id,
    to_peer_id: body.to_peer_id,
    kind: body.kind as SignalKind,
    payload: body.payload && typeof body.payload === "object" ? body.payload : {}
  }).select("id,from_peer_id,to_peer_id,kind,payload,created_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json();
  const peerId = body.peer_id as string | undefined;
  const ids = Array.isArray(body.signal_ids) ? body.signal_ids.filter((x: unknown) => typeof x === "string") : [];
  if (!peerId || ids.length === 0) return NextResponse.json({ error: "peer_id and signal_ids required" }, { status: 400 });

  const { data: peer } = await sb.from("rtc_peers")
    .select("id,user_id")
    .eq("id", peerId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!peer) return NextResponse.json({ error: "peer not found" }, { status: 404 });

  const { error } = await sb.from("rtc_signals")
    .update({ consumed_at: new Date().toISOString() })
    .eq("to_peer_id", peerId)
    .in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, count: ids.length });
}
