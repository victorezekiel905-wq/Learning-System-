import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Teacher starts the game: lobby → running, question 0. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: game } = await sb.from("game_sessions").select("*").eq("id", params.id).maybeSingle();
  if (!game) return NextResponse.json({ error: "game not found" }, { status: 404 });

  const { data: cls } = await sb.from("classes").select("teacher_id").eq("id", game.class_id).maybeSingle();
  if (!cls || cls.teacher_id !== user.id)
    return NextResponse.json({ error: "only the class teacher can start this game" }, { status: 403 });

  const { data, error } = await sb.from("game_sessions").update({
    state: "running", current_question: 0, question_started_at: new Date().toISOString()
  }).eq("id", params.id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await sb.from("audit_logs").insert({
    tenant_id: game.tenant_id, actor_id: user.id, action: "game.started", target: params.id
  });
  return NextResponse.json(data);
}
