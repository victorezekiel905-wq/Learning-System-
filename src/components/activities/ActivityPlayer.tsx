"use client";
import { useEffect, useMemo, useState } from "react";
import { RichText } from "@/components/RichText";
import { Alert, Badge, Button, Spinner, useToast } from "@/components/ui";
import { useNow } from "@/lib/hooks";
import { sendOrQueue, useOfflineQueue } from "@/lib/offline-queue";
import { errorText, rpc } from "@/lib/rpc";
import type { ActivitySettings, PublicQuestion } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CollabBoard } from "./CollabBoard";
import { isAnswered, Prompt, QuestionInput, type Answer } from "./QuestionInput";
import { BADGE_LABEL, CHALLENGE, type Progress } from "@/lib/progress";
import { Icon } from "@/components/Icon";

type Started = {
  attempt: { id: string; attempt_no: number; deadline_at: string | null; status: string; server_now: string; level?: 1 | 2 | 3 | null };
  activity: { id: string; kind: string; title: string; instructions: string | null; settings: ActivitySettings };
  questions: PublicQuestion[];
  answers: Record<string, Answer>;
};

type Feedback = { is_correct?: boolean; score?: number; status: string; correct_option_ids?: string[]; explanation?: string | null; queued?: boolean };
type Finished = {
  attempt: { status: string; score: number | null; max_score: number | null };
  results: { question_id: string; is_correct: boolean | null; score: number | null; status: string; feedback: string | null; explanation: string | null; correct_option_ids: string[] }[] | null;
};

/**
 * Runs one attempt at an activity: start/resume → answer (server-graded,
 * offline-safe) → submit → feedback. Used in live sessions, assignments and
 * shared lessons.
 */
export function ActivityPlayer({ activityId, sessionId, assignmentId, shareCode, tenantId, userId, onFinished, compact }: {
  activityId: string; sessionId?: string; assignmentId?: string; shareCode?: string;
  tenantId: string; userId: string; onFinished?: () => void; compact?: boolean;
}) {
  const toast = useToast();
  const [data, setData] = useState<Started | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [finished, setFinished] = useState<Finished | null>(null);
  const [reward, setReward] = useState<{ xp: number; level: number; levelUp: boolean; badges: string[] } | null>(null);
  const [skew, setSkew] = useState(0);
  const [shownAt, setShownAt] = useState(() => Date.now());
  const { pending } = useOfflineQueue((m) => toast(`An offline answer was rejected: ${m}`, "error"));
  const now = useNow(1000);

  useEffect(() => {
    let live = true;
    rpc<Started>("start_attempt", { p_activity: activityId, p_session: sessionId ?? null, p_assignment: assignmentId ?? null, p_share: shareCode ?? null })
      .then((d) => {
        if (!live) return;
        setData(d);
        setAnswers(d.answers ?? {});
        setSkew(new Date(d.attempt.server_now).getTime() - Date.now());
      })
      .catch((e) => live && setErr(errorText(e)));
    return () => { live = false; };
  }, [activityId, sessionId, assignmentId, shareCode]);

  useEffect(() => setShownAt(Date.now()), [index]);

  const remaining = useMemo(() => {
    if (!data?.attempt.deadline_at) return null;
    return Math.max(0, Math.round((new Date(data.attempt.deadline_at).getTime() - (now + skew)) / 1000));
  }, [data, now, skew]);

  useEffect(() => {
    if (remaining === 0 && !finished && data) void finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining]);

  if (err) return <Alert tone="warn">{err}</Alert>;
  if (!data) return <div className="flex items-center gap-2 p-6 text-sm text-ink-500"><Spinner /> Loading activity…</div>;

  if (data.activity.kind === "collab_board") {
    return <CollabBoard activityId={data.activity.id} sessionId={sessionId} title={data.activity.title} tenantId={tenantId} userId={userId} />;
  }

  const questions = data.questions;
  const q = questions[index];
  const settings = data.activity.settings ?? {};

  async function save(question: PublicQuestion) {
    const response = answers[question.id];
    if (!isAnswered(question, response)) { toast("Answer the question first.", "error"); return false; }
    setSaving(true);
    try {
      const r = await sendOrQueue<Feedback>("submit_answer", {
        p_attempt: data!.attempt.id, p_question: question.id, p_response: response, p_elapsed_ms: Date.now() - shownAt
      });
      if ("queued" in r) {
        setFeedback((f) => ({ ...f, [question.id]: { status: "queued", queued: true } }));
        toast("You're offline. Your answer is saved on this device and will sync.", "info");
      } else {
        setFeedback((f) => ({ ...f, [question.id]: r }));
      }
      return true;
    } catch (e) {
      toast(errorText(e), "error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function finish() {
    setSaving(true);
    try {
      const before = await rpc<Progress>("my_progress").catch(() => null);
      const r = await rpc<Finished>("finish_attempt", { p_attempt: data!.attempt.id });
      setFinished(r);
      const after = await rpc<Progress>("my_progress").catch(() => null);
      if (before && after) {
        const had = new Set(before.badges.map((b) => b.badge));
        setReward({ xp: after.xp - before.xp, level: after.level, levelUp: after.level > before.level,
                    badges: after.badges.map((b) => b.badge).filter((b) => !had.has(b)) });
      }
      onFinished?.();
    } catch (e) { toast(errorText(e), "error"); }
    setSaving(false);
  }

  if (finished) {
    const byId = Object.fromEntries((finished.results ?? []).map((r) => [r.question_id, r]));
    const pendingReview = finished.attempt.status === "submitted";
    return (
      <div className="card card-pad space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold">Submitted: {data.activity.title}</h3>
          {finished.attempt.max_score ? (
            <Badge tone="brand" className="text-sm">{Number(finished.attempt.score ?? 0)} / {Number(finished.attempt.max_score)}{pendingReview && " so far"}</Badge>
          ) : null}
        </div>
        {reward && reward.xp > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900" role="status">
            <span className="font-display text-2xl font-extrabold">+{reward.xp} XP</span>
            <span className="text-sm">{reward.levelUp ? `Level up! You're now level ${reward.level}.` : `Level ${reward.level}`}</span>
            {reward.badges.map((b) => <Badge key={b} tone="amber"><Icon name="award" className="inline h-3.5 w-3.5 align-[-2px]" /> {BADGE_LABEL[b] ?? b}</Badge>)}
          </div>
        )}
        {pendingReview && <Alert>Some answers will be marked by your teacher. You'll get a notification when they're reviewed.</Alert>}
        {finished.results && (
          <ul className="space-y-3">
            {questions.map((qq, i) => {
              const r = byId[qq.id];
              return (
                <li key={qq.id} className="rounded-lg border border-ink-200 p-3">
                  <p className="text-sm font-medium">{i + 1}. <RichText text={qq.prompt} className="inline" /></p>
                  <p className="mt-1 text-sm">
                    {!r ? <span className="text-ink-500">Not answered</span>
                      : r.status === "pending_review" ? <Badge tone="amber">Awaiting review</Badge>
                      : r.status === "ungraded" ? <Badge>Recorded</Badge>
                      : r.is_correct ? <Badge tone="green">Correct</Badge> : <Badge tone="red">Not quite{r.score ? ` (${r.score} pts)` : ""}</Badge>}
                  </p>
                  {r?.correct_option_ids?.length && !r.is_correct ? (
                    <p className="mt-1 text-xs text-ink-600">Correct: {qq.options.filter((o) => r.correct_option_ids.includes(o.id)).map((o) => o.label).join(", ")}</p>
                  ) : null}
                  {r?.explanation && <p className="mt-1 text-xs text-ink-600">{r.explanation}</p>}
                  {r?.feedback && <p className="mt-1 text-xs text-brand-700">Teacher: {r.feedback}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  if (!q) return <Alert>This activity has no questions yet.</Alert>;
  const fb = feedback[q.id];
  const answeredCount = questions.filter((x) => feedback[x.id] || data.answers[x.id]).length;

  return (
    <div className={cn("card space-y-5", compact ? "p-4" : "card-pad")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold text-ink-600">{data.activity.title}</p>
          {questions.length > 1 && <p className="text-xs text-ink-500">Question {index + 1} of {questions.length} · {answeredCount} answered</p>}
        </div>
        <div className="flex items-center gap-2">
          {data.attempt.level && <span title={CHALLENGE[data.attempt.level].hint}><Badge tone="brand">{CHALLENGE[data.attempt.level].name} challenge</Badge></span>}
          {pending > 0 && <Badge tone="amber">{pending} waiting to sync</Badge>}
          {remaining !== null && <Badge tone={remaining < 30 ? "red" : "gray"}>⏱ {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</Badge>}
        </div>
      </div>
      {index === 0 && data.activity.instructions && <RichText text={data.activity.instructions} className="text-sm text-ink-600" />}

      <Prompt q={q} />
      <QuestionInput q={q} value={answers[q.id]} onChange={(v) => { setAnswers((a) => ({ ...a, [q.id]: v })); setFeedback((f) => { const n = { ...f }; delete n[q.id]; return n; }); }}
        uploadPrefix={`${tenantId}/${userId}/${data.attempt.id}`} reveal={fb?.correct_option_ids ? { correct_option_ids: fb.correct_option_ids } : undefined} />

      {fb && !fb.queued && fb.status === "auto_graded" && fb.is_correct !== undefined && (
        <Alert tone={fb.is_correct ? "success" : "warn"}>{fb.is_correct ? "Correct!" : "Not quite."}{fb.explanation ? ` ${fb.explanation}` : ""}</Alert>
      )}
      {fb && (fb.status === "pending_review" || fb.status === "ungraded" || (fb.status === "auto_graded" && fb.is_correct === undefined)) && <Alert tone="success">Answer saved.</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {questions.length > 1 && <Button variant="secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}>Back</Button>}
          <Button variant="secondary" loading={saving} onClick={() => save(q)}>{fb ? "Update answer" : "Save answer"}</Button>
        </div>
        {index < questions.length - 1 ? (
          <Button onClick={async () => { if (!fb && isAnswered(q, answers[q.id])) await save(q); setIndex(index + 1); }}>Next</Button>
        ) : (
          <Button loading={saving} onClick={async () => { if (!fb && isAnswered(q, answers[q.id]) && !(await save(q))) return; await finish(); }}>
            Submit{settings.attempts_allowed && settings.attempts_allowed > 1 ? ` (attempt ${data.attempt.attempt_no} of ${settings.attempts_allowed})` : ""}
          </Button>
        )}
      </div>
    </div>
  );
}
