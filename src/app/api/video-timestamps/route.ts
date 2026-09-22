import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Interactive video: timestamped questions/notes attached to a lesson.
export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.lesson_id || !body.video_url || typeof body.t_seconds !== "number" || !body.kind)
    return NextResponse.json({ error: "lesson_id, video_url, t_seconds, kind required" }, { status: 400 });
  if (!["question", "note"].includes(body.kind))
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });

  const { data: me } = await sb.from("users").select("tenant_id").eq("id", user.id).maybeSingle();
  if (!me) return NextResponse.json({ error: "profile not set up" }, { status: 400 });

  const { data, error } = await sb.from("video_timestamps").insert({
    tenant_id: me.tenant_id,
    lesson_id: body.lesson_id,
    video_url: body.video_url,
    t_seconds: Math.max(0, Math.floor(body.t_seconds)),
    kind: body.kind,
    payload: body.payload ?? {}
  }).select("id,t_seconds,kind").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function GET(req: NextRequest) {
  const sb = createClient();
  const lesson = req.nextUrl.searchParams.get("lesson_id");
  if (!lesson) return NextResponse.json({ error: "lesson_id required" }, { status: 400 });
  const { data } = await sb.from("video_timestamps")
    .select("id,t_seconds,kind,payload").eq("lesson_id", lesson).order("t_seconds", { ascending: true });
  return NextResponse.json(data ?? []);
}
