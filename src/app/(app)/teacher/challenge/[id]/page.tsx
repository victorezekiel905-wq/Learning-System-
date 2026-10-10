import { requireRole, TEACHERS } from "@/lib/session";
import { GameHost } from "./GameHost";

export const metadata = { title: "Host Challenge" };

export default async function HostPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { me, sb } = await requireRole(TEACHERS);
  const { data: game } = await sb.from("game_sessions").select("session_id").eq("id", params.id).maybeSingle();
  return <GameHost gameId={params.id} school={me.tenant?.name ?? ""} sessionId={game?.session_id ?? null} />;
}
