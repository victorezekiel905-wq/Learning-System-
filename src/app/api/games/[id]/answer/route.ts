import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.question_id || !body.response || !body.nickname) {
    return NextResponse.json({ error: "question_id, response, nickname required" }, { status: 400 });
  }
  // Grading happens in a security-definer RPC so students never read answer keys.
  const { data, error } = await sb.rpc("game_grade_answer", {
    p_game: params.id,
    p_question: body.question_id,
    p_value: String(body.response),
    p_nickname: body.nickname
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? {});
}
