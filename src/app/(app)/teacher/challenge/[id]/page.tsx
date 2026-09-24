import { requireRole, TEACHERS } from "@/lib/session";
import { GameHost } from "./GameHost";

export const metadata = { title: "Host Challenge" };

export default async function HostPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { me } = await requireRole(TEACHERS);
  return <GameHost gameId={params.id} school={me.tenant?.name ?? ""} />;
}
