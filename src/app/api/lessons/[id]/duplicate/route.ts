import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Deep-duplicate a lesson: slides + activities + questions. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: src } = await sb.from("lessons").select("*").eq("id", params.id).maybeSingle();
  if (!src) return NextResponse.json({ error: "lesson not found" }, { status: 404 });

  const { data: copy, error } = await sb.from("lessons").insert({
    tenant_id: src.tenant_id, owner_id: user.id,
    title: `${src.title} (copy)`, description: src.description,
    status: "draft", mode: src.mode
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const { data: slides } = await sb.from("lesson_slides").select("*").eq("lesson_id", params.id).order("idx");
  for (const s of slides ?? []) {
    await sb.from("lesson_slides").insert({
      lesson_id: copy.id, idx: s.idx, kind: s.kind, payload: s.payload
    });
  }

  const { data: activities } = await sb.from("activities").select("*").eq("lesson_id", params.id);
  for (const a of activities ?? []) {
    const { data: act } = await sb.from("activities").insert({
      lesson_id: copy.id, kind: a.kind, title: a.title, config: a.config
    }).select("id").single();
    if (!act) continue;
    const { data: questions } = await sb.from("questions").select("*").eq("activity_id", a.id);
    for (const q of questions ?? []) {
      await sb.from("questions").insert({
        activity_id: act.id, prompt: q.prompt, options: q.options,
        answer_key: q.answer_key, points: q.points
      });
    }
  }

  await sb.from("audit_logs").insert({
    tenant_id: src.tenant_id, actor_id: user.id,
    action: "lesson.duplicated", target: params.id, meta: { copy_id: copy.id }
  });
  return NextResponse.json(copy);
}
