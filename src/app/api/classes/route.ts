import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data: classes, error } = await sb.from("classes")
    .select("id,name,join_code,teacher_id,created_at,class_members(count)")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(classes ?? []);
}

export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "name required" }, { status: 400 });

  const { data: me } = await sb.from("users").select("id,tenant_id").eq("id", user.id).maybeSingle();
  if (!me) return NextResponse.json({ error: "profile not set up — call /api/auth/setup first" }, { status: 400 });

  const { data: cls, error } = await sb.from("classes").insert({
    tenant_id: me.tenant_id, name: body.name,
    join_code: code(), teacher_id: me.id
  }).select("id,name,join_code").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await sb.from("class_members").upsert({
    class_id: cls.id, user_id: me.id, role: "teacher"
  }, { onConflict: "class_id,user_id" });
  return NextResponse.json(cls);
}

function code(): string {
  const a = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
