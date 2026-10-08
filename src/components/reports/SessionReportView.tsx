import { Badge, Card, Stat } from "@/components/ui";
import { ALERT_LABEL } from "@/components/live/types";
import { cn, formatDateTime } from "@/lib/utils";

/** The shape of public.session_report (version 2, migration 0920). */
export type SessionReportV2 = {
  version: 2;
  session: { id: string; title: string; started_at: string | null; ended_at: string | null; minutes: number; lesson_title: string | null };
  class: { id: string; name: string } | null;
  monitoring: boolean;
  enrolled: number; joined: number; guests: number; accuracy: number | null; answers: number; hands: number;
  commands: number | null; alerts: Record<string, number>;
  questions: {
    question_id: string; activity: string; prompt: string; kind: string; answered: number; correct: number;
    accuracy: number | null; avg_seconds: number | null;
    options: { id: string; label: string; is_correct: boolean; count: number }[];
    missed_by: string[];
    written: { name: string; text: string; is_correct: boolean | null }[] | null;
  }[];
  students: {
    student_id: string; name: string; guest: boolean; removed: boolean; joined: boolean; score: number; rank: number | null;
    best_streak: number; answers: number; correct: number; accuracy: number | null; avg_seconds: number | null; alerts: number | null;
  }[];
};

const KIND: Record<string, string> = { mcq: "Multiple choice", multi_select: "Choose all that apply", true_false: "True or false", poll: "Poll",
  open: "Written answer", short: "Short answer", fill_blank: "Fill in the blank" };

function pctTone(p: number | null) {
  if (p === null) return "bg-ink-300";
  return p >= 75 ? "bg-emerald-500" : p >= 50 ? "bg-amber-400" : "bg-rose-500";
}

function Meter({ value, className }: { value: number | null; className?: string }) {
  return (
    <span className={cn("block h-2 overflow-hidden rounded-full bg-ink-100", className)} aria-hidden>
      <span className={cn("block h-full rounded-full", pctTone(value))} style={{ width: `${value ?? 0}%` }} />
    </span>
  );
}

export function SessionReportView({ id, r }: { id: string; r: SessionReportV2 }) {
  const took = r.students.filter((s) => s.joined);
  const graded = r.questions.filter((q) => q.accuracy !== null && q.answered > 0);
  const hardest = [...graded].sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0)).filter((q) => (q.accuracy ?? 100) < 60).slice(0, 3);
  const struggling = took.filter((s) => s.accuracy !== null && s.accuracy < 50 && s.answers > 0);
  const absent = r.students.filter((s) => !s.joined && !s.guest);
  const where = r.class?.name ?? "Joined with the code";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-extrabold tracking-tight text-ink-900">{r.session.title}</h2>
          <p className="text-sm text-ink-600">
            {where}{r.session.lesson_title && r.session.lesson_title !== r.session.title ? ` · ${r.session.lesson_title}` : ""}
            {r.session.started_at ? ` · ${formatDateTime(r.session.started_at)}` : ""} · {r.session.minutes} min
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <a className="btn btn-secondary btn-sm no-underline" href={`/api/reports/${id}/export`}>Scores CSV</a>
          <a className="btn btn-secondary btn-sm no-underline" href={`/api/reports/${id}/export?part=questions`}>Questions CSV</a>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <Stat label="Took part" value={r.class ? `${r.joined} of ${r.enrolled + r.guests}` : r.joined}
          sub={r.guests ? `${r.guests} with the code` : undefined} />
        <Stat label="Class accuracy" value={r.accuracy === null ? "–" : `${r.accuracy}%`} tone={r.accuracy === null ? undefined : r.accuracy >= 60 ? "green" : "red"} />
        <Stat label="Answers" value={r.answers} sub={`${r.questions.length} question${r.questions.length === 1 ? "" : "s"}`} />
        <Stat label="Hands raised" value={r.hands} />
      </div>

      {(hardest.length > 0 || struggling.length > 0 || absent.length > 0) && (
        <Card title="Worth a look">
          <ul className="space-y-2 text-sm text-ink-800">
            {hardest.map((q) => (
              <li key={q.question_id}><b>{q.accuracy}% right:</b> “{q.prompt}” Worth going over again; the most common wrong answer is below.</li>
            ))}
            {struggling.length > 0 && <li><b>Below 50%:</b> {struggling.map((s) => s.name).join(", ")}.</li>}
            {absent.length > 0 && <li><b>Didn’t join:</b> {absent.map((s) => s.name).join(", ")}.</li>}
          </ul>
        </Card>
      )}

      <Card title="Scores" pad={false}>
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th className="w-12">Rank</th><th>Name</th><th className="text-right">Points</th><th className="text-right">Answered</th>
              <th className="w-40">Accuracy</th><th className="text-right">Avg time</th><th className="text-right">Best streak</th>
              {r.monitoring && <th className="text-right">Alerts</th>}</tr></thead>
            <tbody>
              {r.students.map((s) => (
                <tr key={s.student_id} className={cn(!s.joined && "text-ink-400")}>
                  <td className="font-bold">{s.rank ?? "–"}</td>
                  <td>{s.name} {s.guest && <Badge>code</Badge>} {s.removed && <Badge tone="red">removed</Badge>}{!s.joined && <span className="text-xs"> (didn’t join)</span>}</td>
                  <td className="text-right font-semibold tabular-nums">{s.joined ? s.score.toLocaleString() : ""}</td>
                  <td className="text-right tabular-nums">{s.joined ? s.answers : ""}</td>
                  <td>{s.accuracy !== null && <span className="flex items-center gap-2"><Meter value={s.accuracy} className="flex-1" /><span className="w-9 text-right tabular-nums">{s.accuracy}%</span></span>}</td>
                  <td className="text-right tabular-nums">{s.avg_seconds !== null ? `${s.avg_seconds} s` : ""}</td>
                  <td className="text-right tabular-nums">{s.joined && s.best_streak ? s.best_streak : ""}</td>
                  {r.monitoring && <td className="text-right tabular-nums">{s.alerts || ""}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <section className="space-y-3">
        <h3 className="font-display text-lg font-bold text-ink-900">Question by question</h3>
        {r.questions.length === 0 && <Card><p className="text-sm text-ink-500">No questions were answered in this lesson.</p></Card>}
        {r.questions.map((q, i) => {
          const wrongTop = [...q.options].filter((o) => !o.is_correct && o.count > 0).sort((a, b) => b.count - a.count)[0];
          const most = Math.max(1, ...q.options.map((o) => o.count));
          const isPoll = q.kind === "poll";
          return (
            <Card key={q.question_id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-ink-500">Question {i + 1} · {KIND[q.kind] ?? q.kind} · {q.activity}</p>
                  <p className="mt-0.5 font-semibold text-ink-900">{q.prompt}</p>
                </div>
                <div className="w-full shrink-0 text-sm sm:w-44 sm:text-right">
                  {q.accuracy !== null && !isPoll ? <><span className="font-display text-2xl font-extrabold text-ink-900">{q.accuracy}%</span> <span className="text-ink-500">right</span>
                    <Meter value={q.accuracy} className="mt-1" /></> : null}
                  <span className="mt-1 block text-xs text-ink-500">{q.answered} answered{q.avg_seconds !== null ? ` · ${q.avg_seconds} s average` : ""}</span>
                </div>
              </div>
              {q.options.length > 0 && (
                <ul className="mt-4 space-y-1.5">
                  {q.options.map((o) => (
                    <li key={o.id} className="grid grid-cols-[1fr_2.5rem] items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[minmax(0,14rem)_1fr_2.5rem]">
                      <span className={cn("col-span-2 truncate sm:col-span-1", o.is_correct && !isPoll && "font-semibold text-emerald-700")}>
                        {o.is_correct && !isPoll ? "✓ " : ""}{o.label}
                        {o === wrongTop && !isPoll && <Badge tone="amber" className="ml-1.5">most common wrong answer</Badge>}
                      </span>
                      <span className="block h-5 overflow-hidden rounded bg-ink-100" aria-hidden>
                        <span className={cn("block h-full rounded", isPoll ? "bg-brand-500" : o.is_correct ? "bg-emerald-500" : "bg-ink-400")} style={{ width: `${(o.count / most) * 100}%` }} />
                      </span>
                      <span className="text-right tabular-nums text-ink-700">{o.count}</span>
                    </li>
                  ))}
                </ul>
              )}
              {q.missed_by.length > 0 && (
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer font-semibold text-ink-700">Got it wrong ({q.missed_by.length})</summary>
                  <p className="mt-1 text-ink-700">{q.missed_by.join(", ")}</p>
                </details>
              )}
              {q.written && q.written.length > 0 && (
                <details className="mt-3 text-sm" open={q.written.length <= 6}>
                  <summary className="cursor-pointer font-semibold text-ink-700">Answers ({q.written.length})</summary>
                  <ul className="mt-2 divide-y divide-ink-100 rounded-lg border border-ink-100">
                    {q.written.map((w, j) => (
                      <li key={j} className="flex gap-3 px-3 py-2">
                        <span className="w-24 shrink-0 font-medium text-ink-900 sm:w-32">{w.name}</span>
                        <span className="min-w-0 flex-1 whitespace-pre-wrap text-ink-700">{w.text}</span>
                        {w.is_correct !== null && <span className={w.is_correct ? "text-emerald-700" : "text-rose-600"}>{w.is_correct ? "✓" : "✗"}</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          );
        })}
      </section>

      {r.monitoring && (
        <Card title="Monitoring">
          <p className="text-sm text-ink-700">
            {Object.keys(r.alerts).length ? Object.entries(r.alerts).map(([k, v]) => `${ALERT_LABEL[k] ?? k.replace(/_/g, " ")}: ${v}`).join(" · ") : "No alerts."}
            {r.commands ? ` · Teacher commands: ${r.commands}` : ""}
          </p>
        </Card>
      )}
    </div>
  );
}
