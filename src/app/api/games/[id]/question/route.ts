import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** POST — teacher advances to question idx (or -1 to end questions). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  const idx = typeof body.idx === "number" ? body.idx : -1;

  const { data: game } = await sb.from("game_sessions").select("class_id,tenant_id").eq("id", params.id).maybeSingle();
  if (!game) return NextResponse.json({ error: "game not found" }, { status: 404 });
  const { data: cls } = await sb.from("classes").select("teacher_id").eq("id", game.class_id).maybeSingle();
  if (!cls || cls.teacher_id !== user.id)
    return NextResponse.json({ error: "only the class teacher can advance questions" }, { status: 403 });

  const { data, error } = await sb.from("game_sessions").update({
    current_question: idx, question_started_at: new Date().toISOString()
  }).eq("id", params.id).select("id,current_question").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

/** GET — student-facing: current question only, answer key stripped (RPC). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: game } = await sb.from("game_sessions")
    .select("id,state,current_question,question_started_at").eq("id", params.id).maybeSingle();
  if (!game) return NextResponse.json({ error: "game not found" }, { status: 404 });

  if (game.state !== "running" || game.current_question < 0) {
    return NextResponse.json({ state: game.state, question: null });
  }
  const { data, error } = await sb.rpc("game_question", {
    p_game: params.id, p_idx: game.current_question
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const row = (data ?? [])[0] as { question_id: string; prompt: string; options: unknown[]; points: number; total: number } | undefined;
  return NextResponse.json({
    state: game.state,
    question: row ? { ...row, index: game.current_question } : null,
    question_started_at: game.question_started_at
  });
}
