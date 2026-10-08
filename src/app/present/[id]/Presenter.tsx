"use client";
import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { SlideView, type SlideData } from "@/components/slides/SlideView";
import { BOARD_H, BOARD_W, StrokeLayer } from "@/components/slides/Whiteboard";
import type { SessionState } from "@/components/live/types";
import { useAnnotations } from "@/lib/annotations";
import { useLoader, useRpc } from "@/lib/hooks";
import { useSignal } from "@/lib/realtime";
import { rpc } from "@/lib/rpc";
import { Icon } from "@/components/Icon";
import { avatarFor } from "@/components/live/avatars";
import { Leaderboard } from "@/components/live/Leaderboard";
import { JoinQr } from "@/components/live/JoinQr";
import { formatJoinCode } from "@/lib/utils";
import { AnswerBars, AnswerTiles, TimerRing } from "@/components/game/LiveGame";
import { getSound } from "@/lib/sound";

const TILE_KINDS = ["mcq", "true_false", "poll", "multi_select"];

export function Presenter({ sessionId }: { sessionId: string }) {
  const state = useRpc<SessionState>("teacher_session_state", { p_session: sessionId }, [sessionId], { intervalMs: 15000 });
  const lesson = useLoader(() => rpc<{ slides: SlideData[] }>("session_lesson", { p_session: sessionId }), [sessionId]);
  const spot = useRpc<{ student: string; image: string | null; stale: boolean } | null>("spotlight_view", { p_session: sessionId }, [sessionId], { intervalMs: 3000, enabled: !!state.data?.spotlight?.show_to_class });
  useSignal(`staff:${sessionId}`, ["state"], () => { void state.reload(); void spot.reload(); }, { debounceMs: 100 });
  const s = state.data?.session;
  const ann = useAnnotations(sessionId, s?.current_slide ?? 0);
  const slide = (lesson.data?.slides ?? []).find((x) => x.position === s?.current_slide);
  const results = state.data?.activity;
  const host = typeof window !== "undefined" ? window.location.host : "";
  const here = (state.data?.roster ?? []).filter((r) => r.presence === "online" || r.presence === "idle");

  // Clock skew against the server, so the projector counts down with the phones.
  const [skew, setSkew] = useState(0);
  useEffect(() => { if (state.data?.server_now) setSkew(new Date(state.data.server_now).getTime() - Date.now()); }, [state.data]);
  const timer = state.data?.timer ?? null;
  const q0 = results?.questions[0];
  const gameOn = s?.phase === "active" && !s.show_leaderboard && !spot.data && !!results && !!q0;
  const asking = gameOn && !results!.revealed && !s.responses_visible;
  const revealedTiles = gameOn && results!.revealed && TILE_KINDS.includes(q0!.kind);
  const [timeUp, setTimeUp] = useState<string | null>(null);

  // Music and sound effects (the projector only; browsers need one click first).
  const sound = getSound();
  const [soundOn, setSoundOn] = useState(false);
  useEffect(() => {
    if (!sound.wanted) return;
    const on = () => { sound.enable(); setSoundOn(true); };
    window.addEventListener("pointerdown", on, { once: true });
    window.addEventListener("keydown", on, { once: true });
    return () => { window.removeEventListener("pointerdown", on); window.removeEventListener("keydown", on); };
  }, [sound]);
  const track = !soundOn ? null : s?.phase === "lobby" ? "lobby" : asking && timer && timeUp !== timer.ends_at ? "question" : null;
  useEffect(() => { sound.music(track); }, [sound, track]);
  useEffect(() => () => sound.music(null), [sound]);
  const seen = useRef({ revealed: "", board: "", joined: 0 });
  useEffect(() => {
    if (!soundOn) return;
    const key = results?.revealed ? results.activity.id : "";
    if (key && key !== seen.current.revealed) sound.effect("reveal");
    seen.current.revealed = key;
    const board = s?.show_leaderboard ? s.leaderboard?.at ?? "1" : "";
    if (board && board !== seen.current.board) sound.effect("fanfare");
    seen.current.board = board;
    if (s?.phase === "lobby" && here.length > seen.current.joined) sound.effect("join");
    seen.current.joined = here.length;
  }, [soundOn, sound, results?.revealed, results?.activity.id, s?.show_leaderboard, s?.leaderboard?.at, s?.phase, here.length]);

  return (
    <div className="flex min-h-screen flex-col bg-ink-900 text-white">
      <header className="flex items-center justify-between px-8 py-4">
        <p className="text-lg font-semibold">{s?.title ?? "SwiftCipher"}</p>
        <div className="flex items-center gap-5">
          {s && s.phase !== "lobby" && <p className="text-right text-sm text-ink-300">Join at <strong className="text-white">{host}/join</strong> · code <span className="font-mono text-3xl font-extrabold tracking-[0.2em] text-accent-300">{formatJoinCode(s.join_code)}</span></p>}
          <button type="button" onClick={() => { if (soundOn) { sound.disable(); setSoundOn(false); } else { sound.enable(); setSoundOn(true); } }}
            className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20" aria-pressed={soundOn}>
            {soundOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}{soundOn ? "Music on" : "Music off"}
          </button>
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        {s?.phase === "lobby" ? (
          <div className="text-center">
            <p className="text-2xl text-ink-300">Join at <strong className="text-white">{host}/join</strong></p>
            <div className="mt-4 flex items-center justify-center gap-10">
              <p className="font-mono text-[9rem] font-extrabold leading-none tracking-[0.15em] text-accent-400">{formatJoinCode(s.join_code)}</p>
              <JoinQr code={s.join_code} className="w-48 rounded-2xl bg-white p-3" />
            </div>
            <p className="mt-8 text-2xl text-ink-300">{here.length === 0 ? "Waiting for players…" : `${here.length} joined`}</p>
            <ul className="mx-auto mt-4 flex max-w-5xl flex-wrap justify-center gap-3">
              {here.map((r) => <li key={r.student_id} className="rounded-full bg-white/10 px-4 py-2 text-xl"><span aria-hidden>{avatarFor(r.avatar) ?? "🙂"}</span> {r.name}</li>)}
            </ul>
          </div>
        ) : s?.show_leaderboard && s.leaderboard && s.settings?.leaderboard !== false ? (
          <div className="w-full max-w-4xl">
            <h2 className="mb-8 text-center font-display text-6xl font-extrabold">Leaderboard</h2>
            <Leaderboard entries={s.leaderboard.top.slice(0, 5)} size="lg" />
          </div>
        ) : s?.phase === "paused" ? (
          <p className="text-center font-display text-6xl font-extrabold">👀 Eyes on me</p>
        ) : spot.data ? (
          <figure className="w-full max-w-6xl">
            {spot.data.image && !spot.data.stale ? <img src={spot.data.image} alt={`Spotlight: ${spot.data.student}`} className="w-full rounded-xl" />
              : <div className="grid aspect-video place-items-center rounded-xl bg-ink-800 text-ink-400">Screen unavailable</div>}
            <figcaption className="mt-3 text-center text-xl font-semibold"><Icon name="star" className="inline h-5 w-5 align-[-3px] text-accent-400" /> {spot.data.student}</figcaption>
          </figure>
        ) : asking ? (
          <div className="w-full max-w-6xl space-y-8">
            <div className="flex items-start justify-between gap-8">
              <div className="min-w-0">
                <p className="text-lg text-ink-300">{results!.activity.title}{results!.questions.length > 1 ? ` · ${results!.questions.length} questions, answer on your device` : ""}</p>
                <h2 className="mt-2 font-display text-5xl font-extrabold leading-tight">{q0!.prompt}</h2>
              </div>
              <div className="flex shrink-0 flex-col items-center gap-2">
                {timer ? <TimerRing timer={timer} skew={skew} size={140} className="text-white"
                  onDone={() => { setTimeUp(timer.ends_at); if (soundOn) sound.effect("timeup"); }}
                  onSecond={(left) => sound.urgent(left > 0 && left <= 5)} /> : null}
                <p className="text-center"><span className="block font-display text-6xl font-extrabold tabular-nums">{results!.answered ?? 0}</span>
                  <span className="text-lg text-ink-300">{(results!.answered ?? 0) === 1 ? "answer" : "answers"}</span></p>
              </div>
            </div>
            {TILE_KINDS.includes(q0!.kind) && <AnswerTiles options={q0!.options} big />}
            {timer && timeUp === timer.ends_at && <p className="text-center font-display text-4xl font-extrabold text-accent-300">Time's up!</p>}
          </div>
        ) : revealedTiles ? (
          <div className="w-full max-w-5xl space-y-8 text-center">
            <h2 className="font-display text-4xl font-extrabold leading-tight">{q0!.prompt}</h2>
            <AnswerBars options={q0!.options} counts={Object.fromEntries(q0!.options.map((o) => [o.id, o.count]))}
              correct={q0!.kind === "poll" ? [] : q0!.options.filter((o) => o.is_correct).map((o) => o.id)} />
            <AnswerTiles options={q0!.options} big correct={q0!.kind === "poll" ? undefined : q0!.options.filter((o) => o.is_correct).map((o) => o.id)} />
          </div>
        ) : results && s?.responses_visible ? (
          <div className="w-full max-w-4xl space-y-6">
            <div className="flex items-baseline justify-between gap-4"><h2 className="text-3xl font-bold">{results.activity.title}</h2>
              {results.answered !== undefined && <p className="text-xl text-ink-300">{results.answered}/{results.joined} answered</p>}</div>
            {results.questions.slice(0, 1).map((q) => (
              <div key={q.question_id} className="space-y-4">
                <p className="text-2xl">{q.prompt}</p>
                {q.options.map((o) => (
                  <div key={o.id}>
                    <div className="mb-1 flex justify-between text-lg"><span>{results.revealed && o.is_correct ? "✓ " : ""}{o.label}</span><span>{o.count}</span></div>
                    <div className="h-6 rounded-full bg-ink-700"><div className={`h-full rounded-full ${results.revealed && !o.is_correct ? "bg-ink-500" : "bg-accent-400"}`} style={{ width: `${(100 * o.count) / Math.max(q.responses, 1)}%` }} /></div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : slide ? (
          <div className="w-full max-w-6xl text-ink-900">
            <SlideView slide={slide} overlay={ann.strokes.length ? <svg viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} className="h-full w-full"><StrokeLayer strokes={ann.strokes} /></svg> : undefined} />
          </div>
        ) : <p className="text-2xl text-ink-400">{s ? "Waiting to start…" : "Loading…"}</p>}
      </main>
    </div>
  );
}
