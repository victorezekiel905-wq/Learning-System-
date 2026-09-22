import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  const body = await req.json();
  if (!body.device_uid || !body.kind) {
    return NextResponse.json({ error: "device_uid, kind required" }, { status: 400 });
  }

  // Resolve tenant from the signed-in user's profile row (NOT user.id).
  let tenantId: string | null = null;
  let ownerId: string | null = null;
  if (user) {
    const { data: me } = await sb.from("users").select("id,tenant_id").eq("id", user.id).maybeSingle();
    tenantId = me?.tenant_id ?? null;
    ownerId = me?.id ?? null;
  }

  const { data, error } = await sb.from("devices").upsert({
    device_uid: body.device_uid, kind: body.kind, tenant_id: tenantId,
    owner_user_id: ownerId, status: "active", last_seen_at: new Date().toISOString(),
    label: body.label ?? null, os: body.os ?? null, browser: body.browser ?? null
  }, { onConflict: "device_uid" }).select("id,device_uid,tenant_id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  if (user && body.student_id) {
    await sb.from("device_enrollments").upsert({
      device_id: data.id, student_id: body.student_id,
      class_id: body.class_id ?? null, enrolled_by: user.id
    }, { onConflict: "device_id" });
  }
  return NextResponse.json(data);
}
