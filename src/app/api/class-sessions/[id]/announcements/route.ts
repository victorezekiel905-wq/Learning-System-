import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.body || !body.body.trim()) return NextResponse.json({ error: "body required" }, { status: 400 });
  const { data, error } = await sb.from("announcements").insert({
    session_id: params.id, user_id: user.id, body: body.body.trim()
  }).select("id,body,created_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const { data: me } = await sb.from("users").select("tenant_id").eq("id", user.id).maybeSingle();
  if (me) {
    await sb.from("notifications").insert({
      tenant_id: me.tenant_id, user_id: user.id, kind: "announcement", payload: { session_id: params.id, body: body.body }
    });
  }
  return NextResponse.json(data);
}
