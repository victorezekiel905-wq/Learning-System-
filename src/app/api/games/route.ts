import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { joinCode } from "@/lib/utils";

export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.class_id || !body.quiz_id) {
    return NextResponse.json({ error: "class_id, quiz_id required" }, { status: 400 });
  }
  const { data: cls } = await sb.from("classes").select("tenant_id").eq("id", body.class_id).single();
  if (!cls) return NextResponse.json({ error: "class not found" }, { status: 404 });
  const { data: game, error } = await sb.from("game_sessions").insert({
    tenant_id: cls.tenant_id, class_id: body.class_id, quiz_id: body.quiz_id,
    join_code: joinCode(), state: "lobby"
  }).select("id,join_code").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(game);
}
