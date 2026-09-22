import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import GamePlayer from "@/components/game/GamePlayer";

export default async function StudentGame({ params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  return <GamePlayer gameId={params.id} />;
}
