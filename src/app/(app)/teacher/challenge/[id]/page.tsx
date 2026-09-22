import { requireRole, TEACHERS } from "@/lib/session";
import { GameHost } from "./GameHost";

export const metadata = { title: "Host Challenge" };

export default async function HostPage({ params }: { params: { id: string } }) {
  const { me } = await requireRole(TEACHERS);
  return <GameHost gameId={params.id} school={me.tenant?.name ?? ""} />;
}
