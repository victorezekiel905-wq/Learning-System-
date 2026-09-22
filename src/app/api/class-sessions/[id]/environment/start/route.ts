import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.policy_id) return NextResponse.json({ error: "policy_id required" }, { status: 400 });

  const { data: sess } = await sb.from("class_sessions").select("class_id").eq("id", params.id).maybeSingle();
  if (!sess) return NextResponse.json({ error: "session not found" }, { status: 404 });
  const { data: cls } = await sb.from("classes").select("teacher_id").eq("id", sess.class_id).maybeSingle();
  if (!cls || cls.teacher_id !== user.id)
    return NextResponse.json({ error: "only the class teacher can apply a policy" }, { status: 403 });

  const { data, error } = await sb.from("class_sessions").update({
    policy_id: body.policy_id
  }).eq("id", params.id).select("id,policy_id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await sb.from("audit_logs").insert({
    tenant_id: null, actor_id: user.id, action: "environment.policy_applied",
    target: params.id, meta: { policy_id: body.policy_id }
  });
  return NextResponse.json(data);
}
