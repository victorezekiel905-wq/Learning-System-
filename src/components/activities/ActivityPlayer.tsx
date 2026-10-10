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
import { useSupports } from "@/lib/supports";
import { AnswerResult, AnswerTiles, TimerRing, useSecondsLeft, type LiveTimer } from "@/components/game/LiveGame";
import { OptionShape } from "@/components/game/Shape";
import { OPTION_COLORS } from "@/components/game/types";
import { buzz } from "@/lib/sound";

/** Question kinds answered by tapping a coloured tile in a live lesson. */
const TILE_KINDS = ["mcq", "true_false", "poll", "multi_select"];

type Started = {
  attempt: { id: string; attempt_no: number; deadline_at: string | null; status: string; server_now: string; level?: 1 | 2 | 3 | null };
  activity: { id: string; kind: string; title: string; instructions: string | null; settings: ActivitySettings };
  questions: PublicQuestion[];
  answers: Record<string, Answer>;
  /** Answers already shown as right/wrong (final) or waiting for their second chance (migration 0800). */
  locked?: Record<string, { revealed: boolean; tries: number; is_correct: boolean | null }>;
};

type Feedback = {
  is_correct?: boolean; score?: number; status: string; correct_option_ids?: string[]; explanation?: string | null; queued?: boolean;
  /** Wrong first try with a second chance left: the answer is not shown yet. */
  second_chance?: boolean; tries?: number;
  /** Revealed earlier (e.g. before a reload): the answer can't change. */
  final?: boolean;
  /** Live lessons (0890): points decided by the server. */
  points?: LivePoints;
};
type LivePoints = { points: number; base: number; speed: number; streak_bonus: number; streak: number; total: number };
type Finished = {
  attempt: { status: string; score: number | null; max_score: number | null; points?: number | null };
  results: { question_id: string; is_correct: boolean | null; score: number | null; status: string; feedback: string | null; explanation: string | null; correct_option_ids: string[] }[] | null;
};

/**
 * Runs one attempt at an activity: start/resume → answer (server-graded,
 * offline-safe) → submit → feedback. Used in live sessions, assignments and
 * shared lessons.
 */
export function ActivityPlayer({ activityId, sessionId, assignmentId, shareCode, tenantId, userId, onFinished, compact, live }: {
  activityId: string; sessionId?: string; assignmentId?: string; shareCode?: string;
  tenantId: string; userId: string; onFinished?: () => void; compact?: boolean;
  /** A teacher-paced live lesson: game tiles, and the class countdown (skew = server − local clock). */
  live?: { timer: LiveTimer | null; skew: number };
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
  const supports = useSupports();
  const liveTimer = live?.timer && live.timer.activity_id === activityId ? live.timer : null;
  const liveLeft = useSecondsLeft(liveTimer, live?.skew ?? 0);
  const timeUp = liveLeft !== null && liveLeft <= 0;

  useEffect(() => {
    let live = true;
    rpc<Started>("start_attempt", { p_activity: activityId, p_session: sessionId ?? null, p_assignment: assignmentId ?? null, p_share: shareCode ?? null })
      .then((d) => {
        if (!live) return;
        setData(d);
        setAnswers(d.answers ?? {});
        // Restore which answers are final and which still have their second chance.
        setFeedback(Object.fromEntries(Object.entries(d.locked ?? {}).map(([id, l]) => [id,
          l.revealed ? { status: "auto_graded", is_correct: l.is_correct ?? undefined, final: true, tries: l.tries }
                     : { status: "auto_graded", is_correct: false, second_chance: true, tries: l.tries }])));
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

  async function save(question: PublicQuestion, override?: Answer) {
    const response = override ?? answers[question.id];
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
        if (live && r.is_correct === true) buzz("correct");
        else if (live && r.is_correct === false && !r.second_chance) buzz("wrong");
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
          {finished.attempt.points != null && <Badge tone="green" className="text-sm">{finished.attempt.points.toLocaleString()} points</Badge>}
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
  // Once the right answer has been shown, the answer is final (no copying it back in).
  const locked = !!fb && !fb.queued && (!!fb.correct_option_ids || !!fb.final);
  // Calm mode: no countdown pressure until the last two minutes.
  const showTimer = remaining !== null && (!supports.calm_mode || remaining <= 120);
  const answeredCount = questions.filter((x) => feedback[x.id] || data.answers[x.id]).length;

  if (live && TILE_KINDS.includes(q.kind)) {
    const multi = q.kind === "multi_select";
    const picked = ((answers[q.id] as { option_ids?: string[]; option_id?: string } | undefined));
    const pickedIds = picked?.option_ids ?? (picked?.option_id ? [picked.option_id] : []);
    const pickedIndex = q.options.findIndex((o) => o.id === pickedIds[0]);
    const pick = async (id: string) => {
      if (multi) { setAnswers((a) => ({ ...a, [q.id]: { option_ids: pickedIds.includes(id) ? pickedIds.filter((x) => x !== id) : [...pickedIds, id] } })); return; }
      const response = { option_id: id };
      setAnswers((a) => ({ ...a, [q.id]: response }));
      setFeedback((f) => { const x = { ...f }; if (!x[q.id]?.second_chance) delete x[q.id]; return x; });
      if (await save(q, response) && index < questions.length - 1) window.setTimeout(() => setIndex((i) => Math.min(i + 1, questions.length - 1)), 1400);
    };
    const graded = fb && !fb.queued && !fb.second_chance && fb.is_correct !== undefined && fb.status === "auto_graded" && q.kind !== "poll";
    const rightLabels = fb?.correct_option_ids ? q.options.filter((o) => fb.correct_option_ids!.includes(o.id)).map((o) => o.label).join(", ") : "";
    const rightIndex = fb?.correct_option_ids ? q.options.findIndex((o) => fb.correct_option_ids!.includes(o.id)) : -1;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          {liveTimer && <TimerRing timer={liveTimer} skew={live.skew} size={56} className="text-ink-900" />}
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink-600">{data.activity.title}{questions.length > 1 ? ` · Question ${index + 1} of ${questions.length}` : ""}</p>
            {pending > 0 && <Badge tone="amber">{pending} waiting to sync</Badge>}
          </div>
        </div>
        <div className="rounded-2xl bg-white p-4 text-xl font-bold text-ink-900 shadow-sm sm:text-2xl"><Prompt q={q} readAloud={supports.read_aloud ? "emphasis" : "offer"} /></div>
        {graded ? (
          <AnswerResult key={`${q.id}-${fb.is_correct}`} correct={!!fb.is_correct} title={fb.is_correct && fb.tries === 2 ? "Correct, second try!" : undefined}
            points={fb.points?.points} extras={fb.points ? [fb.points.speed > 0 && `fast +${fb.points.speed}`, fb.points.streak_bonus > 0 && `streak +${fb.points.streak_bonus}`].filter(Boolean).join(" · ") : undefined}
            streak={fb.points?.streak ?? 0} explanation={fb.explanation}
            answer={!fb.is_correct && rightIndex >= 0 ? { label: rightLabels, index: rightIndex } : null} />
        ) : fb && !fb.second_chance ? (
          <div role="status" className={cn("flex animate-pop flex-col items-center gap-3 rounded-3xl p-8 text-center text-white", pickedIndex >= 0 ? OPTION_COLORS[pickedIndex % OPTION_COLORS.length] : "bg-ink-800")}>
            {pickedIndex >= 0 && <OptionShape i={pickedIndex} className="h-14 w-14" />}
            <p className="font-display text-3xl font-extrabold">{fb.queued ? "Saved offline" : "Answer locked in"}</p>
            <p className="opacity-90">{fb.points && q.kind === "poll" ? `+${fb.points.points} for taking part. ` : ""}{index < questions.length - 1 ? "Next question coming up…" : "Waiting for your teacher to show the answers."}</p>
          </div>
        ) : timeUp ? (
          <div role="status" className="rounded-2xl bg-ink-800 p-8 text-center text-white">
            <p className="font-display text-4xl font-extrabold">Time's up!</p>
            <p className="mt-1 text-ink-300">Be quicker next time. Watch the screen for the answer.</p>
          </div>
        ) : (
          <>
            {fb?.second_chance && <Alert tone="warn" title="Not quite. One more try.">A right answer now earns half the points.</Alert>}
            <AnswerTiles options={q.options} picked={pickedIds} disabled={saving} onPick={(id) => void pick(id)} />
            {multi && <Button size="lg" className="w-full" disabled={!pickedIds.length} loading={saving} onClick={() => void save(q)}>Submit answer</Button>}
          </>
        )}
      </div>
    );
  }

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
          {liveTimer && <TimerRing timer={liveTimer} skew={live!.skew} size={44} className="text-ink-900" />}
          {showTimer && remaining !== null && <Badge tone={remaining < 30 && !supports.calm_mode ? "red" : "gray"}><Icon name="clock" className="h-3.5 w-3.5" /> {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</Badge>}
        </div>
      </div>
      {index === 0 && data.activity.instructions && <RichText text={data.activity.instructions} className="text-sm text-ink-600" />}

      <Prompt q={q} readAloud={supports.read_aloud ? "emphasis" : "offer"} />
      {timeUp && !fb && <Alert tone="warn" title="Time's up!">Answers are closed for this question.</Alert>}
      <QuestionInput q={q} value={answers[q.id]} disabled={locked || (timeUp && !fb)}
        onChange={(v) => {
          setAnswers((a) => ({ ...a, [q.id]: v }));
          // Changing an answer clears "saved"; a pending second chance stays so the retry is counted.
          setFeedback((f) => { if (f[q.id]?.second_chance) return f; const n = { ...f }; delete n[q.id]; return n; });
        }}
        uploadPrefix={`${tenantId}/${userId}/${data.attempt.id}`} reveal={fb?.correct_option_ids ? { correct_option_ids: fb.correct_option_ids } : undefined} />

      {fb?.second_chance && (
        <Alert tone="warn" title="Not quite. You have one more try.">Look again and change your answer. A right answer now earns half the points.</Alert>
      )}
      {fb && !fb.queued && !fb.second_chance && fb.status === "auto_graded" && fb.is_correct !== undefined && (
        <Alert tone={fb.is_correct ? "success" : "warn"}>
          {fb.is_correct ? (fb.tries === 2 ? "Correct on your second try!" : "Correct!") : "Not quite."}{fb.explanation ? ` ${fb.explanation}` : ""}
        </Alert>
      )}
      {fb?.points && !fb.second_chance && <PointsLine p={fb.points} />}
      {fb && (fb.status === "pending_review" || fb.status === "ungraded" || (fb.status === "auto_graded" && fb.is_correct === undefined)) && <Alert tone="success">Answer saved.</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {questions.length > 1 && <Button variant="secondary" disabled={index === 0} onClick={() => setIndex(index - 1)}>Back</Button>}
          {!locked && <Button variant="secondary" loading={saving} onClick={() => save(q)}>{fb?.second_chance ? "Try again" : fb ? "Update answer" : "Save answer"}</Button>}
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

/** "+1,450 points · fast +450 · streak +100" after an answer in a live lesson. */
function PointsLine({ p }: { p: LivePoints }) {
  const extras = [p.speed > 0 && `fast +${p.speed}`, p.streak_bonus > 0 && `streak +${p.streak_bonus}`].filter(Boolean).join(" · ");
  return (
    <div role="status" className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl bg-ink-950 px-4 py-3 text-white">
      <span className="font-display text-2xl font-extrabold text-accent-400">+{p.points.toLocaleString()}</span>
      <span className="text-sm text-ink-200">{p.points === 100 && p.base === 100 ? "for taking part" : extras || "points"}</span>
      <span className="ml-auto text-sm text-ink-300">Total {p.total.toLocaleString()}{p.streak >= 2 ? ` · 🔥 ${p.streak} in a row` : ""}</span>
    </div>
  );
}
