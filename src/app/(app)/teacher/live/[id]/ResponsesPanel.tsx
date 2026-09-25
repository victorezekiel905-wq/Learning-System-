"use client";
import Link from "next/link";
import { useState } from "react";
import { CollabBoard } from "@/components/activities/CollabBoard";
import { Alert, Badge, Button, Card, Empty, Select, useToast } from "@/components/ui";
import type { ActivityResults, SessionState } from "@/components/live/types";
import { createClient } from "@/lib/supabase/client";
import { useLoader, useRpc } from "@/lib/hooks";
import { errorText, rpc } from "@/lib/rpc";
import { pct } from "@/lib/utils";
import type { Me } from "./LiveRoom";
import { ThinkingInsights, type Insight } from "./ThinkingInsights";
import { Icon } from "@/components/Icon";

export function ResponsesPanel({ state, me, reload }: { state: SessionState; me: Me; reload: () => Promise<void> }) {
  const toast = useToast();
  const s = state.session;
  const [picked, setPicked] = useState<string>(s.active_activity_id ?? "");
  const activityId = picked || s.active_activity_id || "";

  const activities = useLoader(async () => {
    const sb = createClient();
    const q = s.lesson_id
      ? sb.from("activities").select("id,title,kind").eq("lesson_id", s.lesson_id)
      : sb.from("activities").select("id,title,kind").is("lesson_id", null).eq("owner_id", me.id).limit(50);
    const { data } = await q;
    return (data ?? []) as { id: string; title: string; kind: string }[];
  }, [s.lesson_id]);

  const results = useLoader(async () => {
    if (!activityId) return null;
    if (activityId === s.active_activity_id && state.activity) return state.activity;
    return rpc<ActivityResults>("activity_results", { p_activity: activityId, p_session: s.id });
  }, [activityId, state.activity], { intervalMs: 5000 });

  const act = (activities.data ?? []).find((a) => a.id === activityId);
  // One request for all questions' reasoning and misconception counts.
  const insights = useRpc<Insight[]>("question_insights", { p_activity: activityId, p_session: s.id }, [activityId, s.id],
    { intervalMs: 8000, enabled: !!activityId && act?.kind !== "collab_board" });
  const r = results.data;

  async function launch(id: string | null) {
    try { await rpc("set_session_state", id ? { p_session: s.id, p_activity: id } : { p_session: s.id, p_clear_activity: true }); await reload(); }
    catch (e) { toast(errorText(e), "error"); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Activity" className="max-w-sm" value={activityId} onChange={(e) => setPicked(e.target.value)}>
          <option value="">Choose an activity…</option>
          {(activities.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.title}{a.id === s.active_activity_id ? " (open)" : ""}</option>)}
        </Select>
        {activityId && (activityId === s.active_activity_id
          ? <Button variant="secondary" onClick={() => launch(null)}>Close for students</Button>
          : <Button onClick={() => launch(activityId)}>Open for students</Button>)}
        <Link href="/teacher/review" className="btn btn-ghost no-underline">Review queue<Icon name="chevronRight" className="h-4 w-4" /></Link>
      </div>

      {!activityId ? <Empty title="No activity selected">Launch an activity from a slide, or pick one here, to see live responses.</Empty>
        : act?.kind === "collab_board" ? <CollabBoard activityId={activityId} sessionId={s.id} title={act.title} tenantId={me.tenantId} userId={me.id} manage />
        : !r ? <p className="text-sm text-ink-500">Loading responses…</p> : (
          <>
            <div className="flex gap-3 text-sm"><Badge tone="brand">{r.attempts} started</Badge><Badge tone="green">{r.submitted} submitted</Badge></div>
            {r.questions.length === 0 && <Alert>This activity has no questions.</Alert>}
            {r.questions.map((q, i) => {
              const total = Math.max(q.responses, 1);
              return (
                <Card key={q.question_id} title={<span>{i + 1}. {q.prompt}</span>}
                  actions={q.kind !== "poll" && q.responses > 0 && ["mcq", "multi_select", "true_false", "fill_blank", "matching", "ordering", "categorize"].includes(q.kind)
                    ? <Badge tone={q.correct / total >= 0.7 ? "green" : q.correct / total >= 0.4 ? "amber" : "red"}>{pct((100 * q.correct) / total)} correct</Badge> : <Badge>{q.responses} responses</Badge>}>
                  {q.options.length > 0 && (
                    <ul className="space-y-2">
                      {q.options.map((o) => (
                        <li key={o.id}>
                          <div className="mb-0.5 flex justify-between text-sm"><span className="flex items-center gap-1.5">{o.is_correct && q.kind !== "poll" && <><Icon name="check" className="h-3.5 w-3.5 text-emerald-700" /><span className="sr-only">Correct answer: </span></>}{o.label}</span><span className="tabular-nums text-ink-500">{o.count}</span></div>
                          <div className="h-2.5 overflow-hidden rounded-full bg-ink-100" role="img" aria-label={`${o.count} of ${q.responses}`}>
                            <div className={`h-full rounded-full ${o.is_correct && q.kind !== "poll" ? "bg-emerald-500" : "bg-brand-500"}`} style={{ width: `${(100 * o.count) / total}%` }} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {q.text_responses.length > 0 && (
                    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                      {q.text_responses.map((t) => (
                        <li key={t.answer_id} className="rounded-lg bg-ink-50 p-2 text-sm">
                          <p className="text-xs font-semibold text-ink-500">{t.student} {t.status === "pending_review" && <Badge tone="amber">needs review</Badge>}</p>
                          <p className="whitespace-pre-wrap">{String(t.response.text ?? (t.response.blanks as string[] | undefined)?.join(", ") ?? t.response.source ?? (t.response.strokes ? "(drawing)" : t.response.name ?? ""))}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {q.avg_elapsed_ms ? <p className="mt-2 text-xs text-ink-500">Average time {Math.round(q.avg_elapsed_ms / 1000)}s</p> : null}
                  <ThinkingInsights insight={insights.data?.find((x) => x.question_id === q.question_id)} />
                </Card>
              );
            })}
          </>
        )}
    </div>
  );
}
