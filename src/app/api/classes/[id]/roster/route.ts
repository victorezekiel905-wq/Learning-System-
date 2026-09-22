import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const { data: members, error } = await sb.from("class_members")
    .select("id,role,joined_at,users(id,full_name,email)")
    .eq("class_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(members ?? []);
}

/** Add a student by email (they must have an account in this tenant already). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.email) return NextResponse.json({ error: "email required" }, { status: 400 });

  const cls = await sb.from("classes").select("id,tenant_id").eq("id", params.id).maybeSingle();
  if (!cls.data || cls.data.tenant_id == null) return NextResponse.json({ error: "class not found" }, { status: 404 });

  const stu = await sb.from("users").select("id,tenant_id")
    .eq("email", body.email as string).maybeSingle();
  if (!stu.data) return NextResponse.json({ error: "no account found for that email" }, { status: 404 });
  if (stu.data.tenant_id !== cls.data.tenant_id)
    return NextResponse.json({ error: "account belongs to another school" }, { status: 400 });

  const { data, error } = await sb.from("class_members").upsert({
    class_id: params.id, user_id: stu.data.id, role: "student"
  }, { onConflict: "class_id,user_id" }).select("id,role").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}

/** Remove a member. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.user_id) return NextResponse.json({ error: "user_id required" }, { status: 400 });
  const { error } = await sb.from("class_members").delete()
    .eq("class_id", params.id).eq("user_id", body.user_id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
