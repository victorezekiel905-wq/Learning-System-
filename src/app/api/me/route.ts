import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ user: null, profile: null }, { status: 200 });
  const { data: profile } = await sb.from("users")
    .select("id,tenant_id,email,full_name,role").eq("id", user.id).maybeSingle();
  return NextResponse.json({
    user: { id: user.id, email: user.email },
    profile: profile ?? null
  });
}
