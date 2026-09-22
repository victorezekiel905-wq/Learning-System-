import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** POST { join_code } → game id for the lobby. */
export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.join_code) return NextResponse.json({ error: "join_code required" }, { status: 400 });
  const { data, error } = await sb.rpc("game_by_code", { p_code: body.join_code.toUpperCase() });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data || data.length === 0) return NextResponse.json({ error: "no game found for that code" }, { status: 404 });
  return NextResponse.json(data[0]);
}
