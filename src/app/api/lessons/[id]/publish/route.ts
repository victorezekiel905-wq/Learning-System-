import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data: lesson } = await sb.from("lessons").select("*").eq("id", params.id).single();
  if (!lesson) return NextResponse.json({ error: "not found" }, { status: 404 });

  // snapshot
  await sb.from("lesson_versions").insert({
    lesson_id: lesson.id, version: (lesson as { version?: number }).version ?? 1, snapshot: lesson
  });
  const { data, error } = await sb.from("lessons").update({ status: "published" }).eq("id", params.id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.redirect(new URL(`/teacher/studio/${params.id}`, _req.url));
}
