import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const sb = createClient();
  const body = await req.json();
  if (!body.device_uid || !body.kind) {
    return NextResponse.json({ error: "device_uid, kind required" }, { status: 400 });
  }
  const { data: dev } = await sb.from("devices").select("id").eq("device_uid", body.device_uid).maybeSingle();
  if (!dev) return NextResponse.json({ error: "device not enrolled" }, { status: 404 });
  const { data, error } = await sb.from("browser_events").insert({
    device_id: dev.id, session_id: body.session_id ?? null, kind: body.kind,
    url: body.url ?? null, title: body.title ?? null
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
