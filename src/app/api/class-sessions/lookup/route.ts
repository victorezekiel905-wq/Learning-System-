import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.join_code) return NextResponse.json({ error: "join_code required" }, { status: 400 });
  const { data, error } = await sb.from("class_sessions")
    .select("id,state,join_code")
    .eq("join_code", body.join_code.toUpperCase())
    .in("state", ["scheduled", "live"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "no live session for that code" }, { status: 404 });
  return NextResponse.json(data);
}
