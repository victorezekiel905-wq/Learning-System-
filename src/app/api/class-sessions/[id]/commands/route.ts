import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.target_student_id || !body.kind) {
    return NextResponse.json({ error: "target_student_id, kind required" }, { status: 400 });
  }
  const { data, error } = await sb.from("teacher_commands").insert({
    session_id: params.id, issued_by: user.id, target_student_id: body.target_student_id,
    kind: body.kind, payload: body.payload ?? {}, state: "queued"
  }).select("id,kind,state,created_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await sb.from("audit_logs").insert({
    tenant_id: null, actor_id: user.id, action: `teacher_command.${body.kind}`,
    target: body.target_student_id, meta: { session_id: params.id }
  });
  return NextResponse.json(data);
}
