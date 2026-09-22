import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.nickname) return NextResponse.json({ error: "nickname required" }, { status: 400 });
  const { data, error } = await sb.from("game_players").insert({
    game_id: params.id, user_id: user.id, nickname: body.nickname, score: 0, streak: 0
  }).select("id,nickname").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
