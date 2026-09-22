import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data, error } = await sb.from("class_sessions").update({
    state: "ended", ended_at: new Date().toISOString()
  }).eq("id", params.id).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await sb.from("audit_logs").insert({
    tenant_id: data.tenant_id ?? null, actor_id: user.id,
    action: "session.ended", target: params.id
  });
  return NextResponse.json(data);
}
