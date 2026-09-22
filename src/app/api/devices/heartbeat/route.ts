import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const sb = createClient();
  const body = await req.json();
  if (!body.device_uid) return NextResponse.json({ error: "device_uid required" }, { status: 400 });
  const { data, error } = await sb.from("devices").update({
    status: "active", last_seen_at: new Date().toISOString()
  }).eq("device_uid", body.device_uid).select("id,status,last_seen_at").maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "device not enrolled" }, { status: 404 });
  return NextResponse.json({ ok: true, ...data });
}
