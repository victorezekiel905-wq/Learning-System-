import { requireRole } from "@/lib/session";
import { GamePlayer } from "./GamePlayer";

export const metadata = { title: "Challenge" };

export default async function PlayPage({ params }: { params: { id: string } }) {
  await requireRole(["student"]);
  return <GamePlayer gameId={params.id} />;
}
