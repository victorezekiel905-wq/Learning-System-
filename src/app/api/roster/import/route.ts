import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// §19 — Bulk roster import. CSV is parsed client-side; rows sent here as JSONB.
// Server applies the rows under the existing security-definer RPC, dedup'd.
export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();
  if (!body.class_id || !Array.isArray(body.rows))
    return NextResponse.json({ error: "class_id, rows[] required" }, { status: 400 });

  const { data, error } = await sb.rpc("roster_csv_apply", {
    p_class_id: body.class_id, p_rows: body.rows
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data);
}
