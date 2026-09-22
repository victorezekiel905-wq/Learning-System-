import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { joinCode } from "@/lib/utils";

export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.class_id) return NextResponse.json({ error: "class_id required" }, { status: 400 });
  const { data, error } = await sb.from("class_sessions").insert({
    class_id: body.class_id, lesson_id: body.lesson_id ?? null, mode: body.mode ?? "live_participation",
    join_code: joinCode(), state: "scheduled"
  }).select("id,join_code").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
