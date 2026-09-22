import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Collab board strokes are appended to a JSON array — one row per board.
export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.title) return NextResponse.json({ error: "title required" }, { status: 400 });

  const { data: me } = await sb.from("users").select("tenant_id").eq("id", user.id).maybeSingle();
  if (!me) return NextResponse.json({ error: "profile not set up" }, { status: 400 });

  const { data, error } = await sb.from("collab_boards").insert({
    tenant_id: me.tenant_id,
    owner_id: user.id,
    session_id: body.session_id ?? null,
    title: body.title,
    strokes: body.strokes ?? []
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function PATCH(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.id || !Array.isArray(body.strokes))
    return NextResponse.json({ error: "id, strokes[] required" }, { status: 400 });

  // Append-only: server concatenates, never overwrites arbitrarily long arrays.
  const { data: existing } = await sb.from("collab_boards").select("strokes").eq("id", body.id).maybeSingle();
  if (!existing) return NextResponse.json({ error: "board not found" }, { status: 404 });
  const merged = (Array.isArray(existing.strokes) ? existing.strokes : []).concat(body.strokes);

  const { data, error } = await sb.from("collab_boards").update({
    strokes: merged, updated_at: new Date().toISOString()
  }).eq("id", body.id).select("id,strokes").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function GET(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const session = req.nextUrl.searchParams.get("session_id");
  if (!session) return NextResponse.json({ error: "session_id required" }, { status: 400 });
  const { data } = await sb.from("collab_boards").select("id,title,strokes,updated_at")
    .eq("session_id", session).order("updated_at", { ascending: false });
  return NextResponse.json(data ?? []);
}
