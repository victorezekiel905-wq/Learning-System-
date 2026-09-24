import { requireRole } from "@/lib/session";
import { GamePlayer } from "./GamePlayer";

export const metadata = { title: "Challenge" };

export default async function PlayPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  await requireRole(["student"]);
  return <GamePlayer gameId={params.id} />;
}
