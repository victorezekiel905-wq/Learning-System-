import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** POST — student raises hand (optional message). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  const { data, error } = await sb.from("raise_hands").insert({
    session_id: params.id, student_id: user.id, message: body?.message ?? ""
  }).select("id,message,created_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

/** GET — open hands for the session. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data, error } = await sb.from("raise_hands")
    .select("id,message,resolved_at,created_at,users(full_name)")
    .eq("session_id", params.id)
    .is("resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? []);
}

/** PATCH — teacher resolves a hand. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.hand_id) return NextResponse.json({ error: "hand_id required" }, { status: 400 });
  const { data, error } = await sb.from("raise_hands")
    .update({ resolved_at: new Date().toISOString() })
    .eq("id", body.hand_id).eq("session_id", params.id)
    .select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
