import Link from "next/link";
import { requireRole, TEACHERS } from "@/lib/session";
import { Alert, Badge, Card, Empty, PageHeader, Stat } from "@/components/ui";
import { pct } from "@/lib/utils";
import { Bars } from "@/components/charts";

export const metadata = { title: "Analytics" };

type Analytics = {
  students: number; sessions: number; participation_rate: number | null; question_accuracy: number | null; avg_response_ms: number | null;
  hardest_questions: { question_id: string; prompt: string; responses: number; accuracy: number }[];
  score_distribution: Record<string, number>; assignment_completion: number | null;
  games: { game_id: string; title: string; players: number; winner: string | null; ended_at: string | null }[];
  environment_leave_rate: number | null; off_task_rate: number | null; device_connectivity_rate: number | null; interventions_per_session: number | null;
  per_student: { student_id: string; name: string; sessions_joined: number; accuracy: number | null; submissions: number; alerts: number }[];
};

export default async function InsightsPage(props: { searchParams: Promise<{ class?: string; days?: string }> }) {
  const searchParams = await props.searchParams;
  const { sb } = await requireRole(TEACHERS);
  const { data: classes } = await sb.rpc("my_teaching_classes");
  const list = (classes as { id: string; name: string }[]) ?? [];
  const classId = searchParams.class ?? list[0]?.id;
  const days = Number(searchParams.days ?? 30);
  const { data } = classId ? await sb.rpc("class_analytics", { p_class: classId, p_days: days }) : { data: null };
  const a = data as Analytics | null;

  return (
    <div className="page">
      <PageHeader eyebrow="SwiftCipher Insights" title="Analytics" subtitle="Learning signals and focus signals are shown separately, and each has its own retention period." />
      {!list.length ? <Empty title="No classes yet" /> : (
        <>
          <form className="mb-5 flex flex-wrap gap-2">
            <select name="class" defaultValue={classId} className="input w-64">{list.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select name="days" defaultValue={String(days)} className="input w-40"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last year</option></select>
            <button className="btn btn-secondary">Update</button>
          </form>
          {a && (
            <div className="space-y-6">
              <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-500">Learning</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                  <Stat label="Participation" value={pct(a.participation_rate)} sub={`${a.sessions} sessions · ${a.students} students`} />
                  <Stat label="Question accuracy" value={pct(a.question_accuracy)} />
                  <Stat label="Avg response time" value={a.avg_response_ms ? `${Math.round(a.avg_response_ms / 1000)}s` : "—"} />
                  <Stat label="Assignment completion" value={pct(a.assignment_completion)} />
                  <Stat label="Games played" value={a.games.length} />
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <Card title="Score distribution">
                    {Object.keys(a.score_distribution).length ? <Bars data={["0%", "20%", "40%", "60%", "80%"].map((k) => ({ label: `${k}+`, value: a.score_distribution[k] ?? 0 }))} /> : <p className="text-sm text-ink-500">No submitted attempts yet.</p>}
                  </Card>
                  <Card title="Hardest questions (difficulty)">
                    {a.hardest_questions.length ? <ul className="space-y-2 text-sm">{a.hardest_questions.map((q) => (
                      <li key={q.question_id} className="flex justify-between gap-3"><span className="truncate">{q.prompt}</span><Badge tone={q.accuracy < 40 ? "red" : "amber"}>{pct(q.accuracy)} of {q.responses}</Badge></li>
                    ))}</ul> : <p className="text-sm text-ink-500">Needs at least 3 responses per question.</p>}
                  </Card>
                </div>
                {a.games.length > 0 && (
                  <Card className="mt-4" title="Leaderboard history">
                    <ul className="space-y-1 text-sm">{a.games.map((g) => <li key={g.game_id}><Link href={`/teacher/challenge/${g.game_id}`}>{g.title}</Link> · {g.players} players{g.winner && ` · won by ${g.winner}`}</li>)}</ul>
                  </Card>
                )}
              </section>
              <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-500">Classroom focus (device telemetry)</h2>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat label="Leave events / session" value={a.environment_leave_rate ?? "—"} />
                  <Stat label="Off-task alerts / session" value={a.off_task_rate ?? "—"} />
                  <Stat label="Device connectivity" value={pct(a.device_connectivity_rate)} />
                  <Stat label="Interventions / session" value={a.interventions_per_session ?? "—"} />
                </div>
                <div className="mt-3"><Alert>Focus signals point to where students might need support. They are not a measure of behaviour, and must never be the only basis for a decision.</Alert></div>
              </section>
              <Card title="Students" pad={false}>
                <table className="table"><thead><tr><th>Student</th><th>Sessions joined</th><th>Accuracy</th><th>Submissions</th><th>Focus alerts</th></tr></thead>
                  <tbody>{a.per_student.map((s) => (
                    <tr key={s.student_id}><td className="font-medium">{s.name}</td><td>{s.sessions_joined}</td><td>{pct(s.accuracy)}</td><td>{s.submissions}</td><td>{s.alerts}</td></tr>
                  ))}</tbody></table>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
