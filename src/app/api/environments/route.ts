import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json([], { status: 401 });
  const { data: policies, error } = await sb.from("environment_policies")
    .select("id,name,mode,allowlist,blocklist,required_urls,class_id")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json([], { status: 400 });
  return NextResponse.json(policies ?? []);
}

export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.name || !body.mode) return NextResponse.json({ error: "name, mode required" }, { status: 400 });
  const { data, error } = await sb.from("environment_policies").insert({
    tenant_id: body.tenant_id ?? null, class_id: body.class_id ?? null,
    name: body.name, mode: body.mode,
    allowlist: body.allowlist ?? [], blocklist: body.blocklist ?? [],
    required_urls: body.required_urls ?? []
  }).select("id,name").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  await sb.from("audit_logs").insert({
    tenant_id: body.tenant_id ?? null, actor_id: user.id,
    action: "policy.created", target: data.id, meta: { mode: body.mode }
  });
  return NextResponse.json(data);
}
