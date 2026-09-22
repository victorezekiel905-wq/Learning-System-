import Link from "next/link";
import { requireRole, TEACHERS } from "@/lib/session";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Challenge" };

export default async function ChallengeList() {
  const { sb } = await requireRole(TEACHERS);
  const { data } = await sb.from("game_sessions").select("id,title,status,join_code,created_at,classes(name),game_players(count)").order("created_at", { ascending: false }).limit(50);
  const games = (data ?? []) as unknown as { id: string; title: string; status: string; join_code: string; created_at: string; classes: { name: string } | null; game_players: { count: number }[] }[];
  return (
    <div className="page">
      <PageHeader eyebrow="SwiftCipher Challenge" title="Challenge" subtitle="Competitive quiz games with speed and streak bonuses, teams and privacy-aware leaderboards."
        actions={<Link href="/teacher/challenge/new" className="btn btn-primary no-underline">New Challenge</Link>} />
      {games.length === 0 ? <Empty title="No games yet">Turn any quiz or multiple-choice activity into a live game.</Empty> : (
        <div className="card overflow-hidden"><table className="table">
          <thead><tr><th>Game</th><th>Class</th><th>Players</th><th>Status</th><th>Created</th><th /></tr></thead>
          <tbody>{games.map((g) => (
            <tr key={g.id}><td className="font-medium">{g.title}</td><td>{g.classes?.name}</td><td>{g.game_players[0]?.count ?? 0}</td>
              <td><Badge tone={g.status === "ended" ? "gray" : "green"}>{g.status === "ended" ? "ended" : `${g.status} · ${g.join_code}`}</Badge></td>
              <td className="text-ink-500">{formatDateTime(g.created_at)}</td>
              <td className="text-right"><Link href={`/teacher/challenge/${g.id}`} className="btn btn-secondary btn-sm no-underline">{g.status === "ended" ? "Results" : "Host"}</Link></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
