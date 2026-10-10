"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useToast } from "@/components/ui";
import { errorText, rpc } from "@/lib/rpc";
import { cn, formatJoinCode } from "@/lib/utils";
import { AVATARS, avatarFor } from "./avatars";
import { Leaderboard, type BoardEntry } from "./Leaderboard";
import { Burst, GlyphField, Podium } from "@/components/game/Celebrate";

/** Before the teacher starts: who you are, your avatar, and how many have joined. */
export function Lobby({ sessionId, title, teacher, name, avatar, participants, code, onAvatar }: {
  sessionId: string; title: string; teacher: string; name: string; avatar: string | null;
  participants: number; code: string; onAvatar: () => void;
}) {
  const toast = useToast();
  const [picked, setPicked] = useState<string | null>(avatar);
  return (
    <div className="relative flex min-h-[calc(100dvh-3.5rem)] flex-col items-center justify-center overflow-hidden bg-ink-950 px-4 py-10 text-white">
      <GlyphField opacity={0.5} />
      <p className="relative text-sm font-semibold text-accent-400">You&apos;re in</p>
      <h1 className="relative mt-2 text-balance text-center font-display text-3xl font-extrabold tracking-tight sm:text-4xl">{title}</h1>
      <p className="relative mt-1 text-ink-300">with {teacher}</p>

      <div className="relative mt-8 flex items-center gap-4 rounded-2xl bg-white/10 px-5 py-4 backdrop-blur-sm">
        <span key={picked ?? "none"} className="grid h-16 w-16 animate-pop place-items-center rounded-2xl bg-accent-400 text-4xl text-ink-950" aria-hidden>{avatarFor(picked) ?? name.slice(0, 1).toUpperCase()}</span>
        <div>
          <p className="text-xl font-bold">{name}</p>
          <p className="text-sm text-ink-300">{participants} {participants === 1 ? "person has" : "people have"} joined</p>
        </div>
      </div>

      <fieldset className="relative mt-6 w-full max-w-sm">
        <legend className="mb-2 text-center text-sm text-ink-300">Pick your avatar</legend>
        <div className="grid grid-cols-6 gap-2">
          {Object.entries(AVATARS).map(([key, emoji]) => (
            <button key={key} type="button" aria-label={key} aria-pressed={picked === key}
              onClick={async () => {
                setPicked(key);
                try { await rpc("set_avatar", { p_session: sessionId, p_avatar: key }); onAvatar(); }
                catch (e) { toast(errorText(e), "error"); }
              }}
              className={cn("grid aspect-square place-items-center rounded-xl text-2xl transition", picked === key ? "scale-110 bg-accent-500 ring-4 ring-accent-400/40" : "bg-white/10 hover:scale-105 hover:bg-white/20")}>
              <span aria-hidden>{emoji}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <p className="relative mt-10 flex items-center gap-2 text-ink-200">
        <span className="h-2 w-2 animate-pulse2 rounded-full bg-accent-400" aria-hidden />
        Waiting for your teacher to start…
      </p>
      <p className="relative mt-2 text-xs text-ink-400">Code <span className="font-mono font-bold tracking-widest text-ink-200">{formatJoinCode(code)}</span></p>
    </div>
  );
}

/** The teacher paused the lesson: everyone looks up. */
export function PausedOverlay({ teacher }: { teacher: string }) {
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="paused-title"
      className="fixed inset-0 z-50 grid place-items-center bg-ink-950/95 px-6 text-center text-white backdrop-blur-sm">
      <div>
        <p className="text-6xl" aria-hidden>👀</p>
        <h2 id="paused-title" className="mt-4 font-display text-4xl font-extrabold tracking-tight">Eyes on your teacher</h2>
        <p className="mt-2 text-lg text-ink-300">{teacher} has paused the lesson. It carries on in a moment.</p>
      </div>
    </div>
  );
}

/** After the lesson: thanks, and how you did. */
export function EndScreen({ name, avatar, summary, guest, score = null }: {
  name: string; avatar: string | null; summary: { answered: number; correct: number } | null; guest: boolean;
  score?: { score: number; rank: number; of: number } | null;
}) {
  const answered = summary?.answered ?? 0;
  const correct = summary?.correct ?? 0;
  return (
    <div className="relative flex min-h-[calc(100dvh-3.5rem)] flex-col items-center justify-center overflow-hidden bg-ink-950 px-4 py-10 text-center text-white">
      <GlyphField opacity={0.45} />
      <span className="relative grid h-20 w-20 animate-pop place-items-center rounded-3xl bg-accent-400 text-5xl" aria-hidden>
        {avatarFor(avatar) ?? "🎉"}{score && score.score > 0 && score.rank <= 3 && <Burst delay={300} />}
      </span>
      <h1 className="relative mt-5 font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Well done, {name}!</h1>
      <p className="relative mt-1 text-ink-300">The lesson has ended.</p>
      {score && score.score > 0 && (
        <p className="relative mt-6 font-display text-5xl font-extrabold text-accent-400">{score.score.toLocaleString()}<span className="ml-2 text-xl text-ink-300">points</span></p>
      )}
      {score && score.score > 0 && <p className="relative mt-1 text-lg text-ink-200">{score.rank <= 3 ? ["🥇", "🥈", "🥉"][score.rank - 1] + " " : ""}#{score.rank} of {score.of}</p>}
      <dl className="relative mt-8 grid w-full max-w-sm grid-cols-2 gap-3">
        <div className="rounded-2xl bg-white/5 p-4"><dt className="text-sm text-ink-300">Answered</dt><dd className="font-display text-4xl font-extrabold">{answered}</dd></div>
        <div className="rounded-2xl bg-white/5 p-4"><dt className="text-sm text-ink-300">Correct</dt><dd className="font-display text-4xl font-extrabold text-accent-400">{correct}</dd></div>
      </dl>
      <Link href={guest ? "/join" : "/student"} className="btn btn-accent btn-lg relative mt-8 no-underline">{guest ? "Join another lesson" : "Back to home"}</Link>
    </div>
  );
}

/** The class leaderboard, while the teacher shows it: top 5, and your own place privately. */
export function BoardOverlay({ entries, me, my }: { entries: BoardEntry[]; me: string; my: { score: number; rank: number; of: number } | null }) {
  const [hidden, setHidden] = useState<string | null>(null);
  const key = JSON.stringify(entries);
  if (hidden === key) return null;
  const inTop = entries.some((e) => e.name === me);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="board-title" className="fixed inset-0 z-40 overflow-y-auto bg-ink-950/95 px-4 py-10 text-white backdrop-blur-sm">
      <div className="mx-auto max-w-md">
        <h2 id="board-title" className="text-center font-display text-3xl font-extrabold tracking-tight">Leaderboard</h2>
        <div className="mt-8"><Podium entries={entries.slice(0, 3)} size="md" highlight={me} /></div>
        {entries.length > 3 && <div className="mt-6"><Leaderboard entries={entries.slice(3)} highlight={me} /></div>}
        {my && !inTop && my.score > 0 && (
          <p className="mt-4 rounded-2xl bg-white/5 px-4 py-3 text-center">You: <strong>#{my.rank}</strong> of {my.of} · <strong className="text-accent-400">{my.score.toLocaleString()}</strong> points</p>
        )}
        <div className="mt-6 text-center"><button type="button" onClick={() => setHidden(key)} className="text-sm text-ink-300 underline hover:text-white">Back to the lesson</button></div>
      </div>
    </div>
  );
}

type Shared = { questions: { question_id: string; prompt: string; options: { id: string; label: string; count: number; is_correct: boolean | null }[] }[] };

/** After the teacher reveals the answers: the class's answers, with the right ones marked. */
export function RevealedResults({ sessionId, activityId }: { sessionId: string; activityId: string }) {
  const [data, setData] = useState<Shared | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    rpc<Shared>("activity_results", { p_activity: activityId, p_session: sessionId })
      .then((d) => { if (live) setData(d); }).catch((e) => { if (live) setErr(errorText(e)); });
    return () => { live = false; };
  }, [activityId, sessionId]);
  if (err) return <p className="text-sm text-ink-500">{err}</p>;
  if (!data) return <p className="text-sm text-ink-500">Loading the answers…</p>;
  return (
    <div className="space-y-6 rounded-2xl bg-ink-950 p-5 text-white sm:p-6">
      <p className="text-sm font-semibold text-accent-400">Answers revealed</p>
      {data.questions.map((q) => {
        const total = Math.max(1, q.options.reduce((n, o) => n + o.count, 0));
        return (
          <div key={q.question_id}>
            <p className="font-display text-lg font-bold">{q.prompt}</p>
            <ul className="mt-3 space-y-2">{q.options.map((o) => (
              <li key={o.id}>
                <div className="mb-1 flex justify-between text-sm"><span>{o.is_correct ? "✓ " : ""}{o.label}</span><span className="tabular-nums">{o.count}</span></div>
                <div className="h-3 rounded-full bg-white/10"><div className={cn("h-full rounded-full", o.is_correct ? "bg-accent-400" : "bg-white/30")} style={{ width: `${(100 * o.count) / total}%` }} /></div>
              </li>
            ))}</ul>
          </div>
        );
      })}
    </div>
  );
}
