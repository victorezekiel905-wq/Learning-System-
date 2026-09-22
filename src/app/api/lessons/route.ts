import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: me } = await sb.from("users").select("id,tenant_id").eq("id", user.id).maybeSingle();
  if (!me) return NextResponse.json({ error: "profile not set up — call /api/auth/setup first" }, { status: 400 });

  const ct = req.headers.get("content-type") ?? "";
  let title = "Untitled lesson";
  let jsonMode = false;

  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : title;
    jsonMode = true;
  } else {
    const fd = await req.formData().catch(() => null);
    const candidate = fd?.get("title") ?? fd?.get("name");
    if (typeof candidate === "string" && candidate.trim()) title = candidate.trim();
  }

  const { data, error } = await sb.from("lessons").insert({
    tenant_id: me.tenant_id,
    owner_id: me.id,
    title,
    status: "draft",
    mode: "live_participation",
    description: null
  }).select("id,title,status,mode").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await sb.from("audit_logs").insert({
    tenant_id: me.tenant_id,
    actor_id: me.id,
    action: "lesson.created",
    target: data.id,
    meta: { title }
  });

  if (jsonMode) return NextResponse.json(data);
  return NextResponse.redirect(new URL(`/teacher/studio/${data.id}`, req.url), 303);
}
