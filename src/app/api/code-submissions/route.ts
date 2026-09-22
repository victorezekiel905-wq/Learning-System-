import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// §3.2 — Optional coding activity. Browser sandbox runs JS via Function ctor;
// this endpoint stores the submission + teacher feedback. Python/HTML/CSS we
// just record + timer-restrict; real grading runs at the activity renderer.
export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.activity_id || !body.language || typeof body.source !== "string")
    return NextResponse.json({ error: "activity_id, language, source required" }, { status: 400 });
  if (!["javascript", "python", "html", "css"].includes(body.language))
    return NextResponse.json({ error: "unsupported language" }, { status: 400 });

  const { data: me } = await sb.from("users").select("tenant_id").eq("id", user.id).maybeSingle();
  if (!me) return NextResponse.json({ error: "profile not set up" }, { status: 400 });

  const { data, error } = await sb.from("code_submissions").insert({
    tenant_id: me.tenant_id,
    activity_id: body.activity_id,
    student_id: user.id,
    language: body.language,
    source: body.source,
    stdout: body.stdout ?? null,
    stderr: body.stderr ?? null,
    grader_feedback: body.grader_feedback ?? {},
    passed: typeof body.passed === "boolean" ? body.passed : null
  }).select("id,passed").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

export async function GET(req: NextRequest) {
  const sb = createClient();
  const activity = req.nextUrl.searchParams.get("activity_id");
  if (!activity) return NextResponse.json({ error: "activity_id required" }, { status: 400 });
  const { data } = await sb.from("code_submissions")
    .select("id,student_id,language,passed,grader_feedback,created_at")
    .eq("activity_id", activity).order("created_at", { ascending: false }).limit(200);
  return NextResponse.json(data ?? []);
}
