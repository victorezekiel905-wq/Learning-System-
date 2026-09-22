import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.lesson_id || !body.title || !body.kind) {
    return NextResponse.json({ error: "lesson_id, title, kind required" }, { status: 400 });
  }
  const { data: act, error: aErr } = await sb.from("activities").insert({
    lesson_id: body.lesson_id, title: body.title, kind: body.kind, config: body.config ?? {}
  }).select("id").single();
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 400 });
  if (body.question) {
    const { error: qErr } = await sb.from("questions").insert({
      activity_id: act.id,
      prompt: body.question.prompt ?? "",
      options: body.question.options ?? [],
      answer_key: { correct: body.question.correct ?? null },
      points: body.question.points ?? 1
    });
    if (qErr) return NextResponse.json({ error: qErr.message }, { status: 400 });
  }
  return NextResponse.json(act);
}
