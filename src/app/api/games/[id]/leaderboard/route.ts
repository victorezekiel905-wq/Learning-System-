import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const [playersRes, gameRes] = await Promise.all([
    sb.from("game_players").select("id,nickname,score,streak").eq("game_id", params.id)
      .order("score", { ascending: false }).order("streak", { ascending: false }).limit(50),
    sb.from("game_sessions").select("id,state").eq("id", params.id).maybeSingle()
  ]);
  const players = (playersRes.data ?? []) as { id: string; nickname: string; score: number; streak: number }[];
  const ranked = players.map((p, i) => ({ ...p, rank: i + 1 }));
  return NextResponse.json({
    state: gameRes.data?.state ?? "ended",
    podium: ranked.slice(0, 3),
    ranking: ranked,
    total: ranked.length
  });
}
