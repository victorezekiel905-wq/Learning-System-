"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Eye, LayoutGrid, Maximize, Minimize, Pause, Play, Trophy, Volume2, VolumeX } from "lucide-react";
import { SlideView, type SlideData } from "@/components/slides/SlideView";
import { BOARD_H, BOARD_W, StrokeLayer } from "@/components/slides/Whiteboard";
import type { SessionState } from "@/components/live/types";
import { useAnnotations } from "@/lib/annotations";
import { useLoader, useRpc } from "@/lib/hooks";
import { useSignal } from "@/lib/realtime";
import { errorText, rpc } from "@/lib/rpc";
import { Icon } from "@/components/Icon";
import { Critter } from "@/components/live/Critter";
import { Leaderboard } from "@/components/live/Leaderboard";
import { GlyphField, Podium } from "@/components/game/Celebrate";
import { JoinQr } from "@/components/live/JoinQr";
import { formatJoinCode } from "@/lib/utils";
import { AnswerBars, AnswerTiles, TimerRing } from "@/components/game/LiveGame";
import { getSound } from "@/lib/sound";
import { useTeacherPresence } from "@/lib/teacher-presence";
import { WordCloud, useWordCloud } from "@/components/game/WordCloud";
import { TeamStandings, useTeamScores } from "@/components/game/Teams";

const TILE_KINDS = ["mcq", "true_false", "poll", "multi_select"];

export function Presenter({ sessionId }: { sessionId: string }) {
  useTeacherPresence(sessionId);
  const state = useRpc<SessionState>("teacher_session_state", { p_session: sessionId }, [sessionId], { intervalMs: 15000 });
  const lesson = useLoader(() => rpc<{ slides: SlideData[] }>("session_lesson", { p_session: sessionId }), [sessionId]);
  const spot = useRpc<{ student: string; image: string | null; stale: boolean } | null>("spotlight_view", { p_session: sessionId }, [sessionId], { intervalMs: 3000, enabled: !!state.data?.spotlight?.show_to_class });
  useSignal(`staff:${sessionId}`, ["state"], () => { void state.reload(); void spot.reload(); }, { debounceMs: 100 });
  const s = state.data?.session;
  const ann = useAnnotations(sessionId, s?.current_slide ?? 0);
  const slide = (lesson.data?.slides ?? []).find((x) => x.position === s?.current_slide);
  const results = state.data?.activity;
  const isCloud = results?.questions[0]?.kind === "word_cloud";
  const cloud = useWordCloud(results?.activity.id, sessionId, isCloud);
  const teamsOn = (state.data?.session.settings?.teams ?? 0) >= 2;
  const teams = useTeamScores(sessionId, state.data?.session.leaderboard?.at, teamsOn && !!state.data?.session.show_leaderboard);
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
    <div className="flex min-h-screen flex-col bg-ink-900 pb-20 text-white">
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
      <main className="relative flex flex-1 items-center justify-center overflow-hidden p-6">
        {s?.phase === "lobby" && <GlyphField opacity={0.4} />}
        {s?.phase === "lobby" ? (
          <div className="relative text-center">
            <p className="text-2xl text-ink-300">Join at <strong className="text-white">{host}/join</strong></p>
            <div className="mt-4 flex items-center justify-center gap-10">
              <p className="font-mono text-[9rem] font-extrabold leading-none tracking-[0.15em] text-accent-400">{formatJoinCode(s.join_code)}</p>
              <JoinQr code={s.join_code} className="w-48 rounded-2xl bg-white p-3" />
            </div>
            <p className="mt-8 text-2xl text-ink-300">{here.length === 0 ? "Waiting for players…" : `${here.length} joined`}</p>
            <ul className="mx-auto mt-4 flex max-w-5xl flex-wrap justify-center gap-3">
              {here.map((r, i) => <li key={r.student_id} className="animate-pop rounded-full bg-white/10 px-4 py-2 text-xl" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}><Critter name={r.avatar} className="mr-1.5 h-8 w-8 align-[-0.35em]" /> {r.name}</li>)}
            </ul>
          </div>
        ) : s?.show_leaderboard && s.leaderboard && s.settings?.leaderboard !== false ? (
          <div className="w-full max-w-4xl" key={s.leaderboard.at ?? "board"}>
            <h2 className="mb-10 text-center font-display text-6xl font-extrabold">Leaderboard</h2>
            {teamsOn && (teams.data ?? []).length > 0 && <div className="mx-auto mb-10 max-w-3xl"><TeamStandings teams={teams.data!} big /></div>}
            <Podium entries={s.leaderboard.top.slice(0, 3)} />
            {s.leaderboard.top.length > 3 && <div className="mx-auto mt-8 max-w-2xl"><Leaderboard entries={s.leaderboard.top.slice(3, 5)} size="lg" /></div>}
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
            {isCloud && <WordCloud words={cloud.data ?? []} dark big />}
            {timer && timeUp === timer.ends_at && <p className="text-center font-display text-4xl font-extrabold text-accent-300">Time's up!</p>}
          </div>
        ) : revealedTiles ? (
          <div className="w-full max-w-5xl space-y-8 text-center">
            <h2 className="font-display text-4xl font-extrabold leading-tight">{q0!.prompt}</h2>
            <AnswerBars options={q0!.options} counts={Object.fromEntries(q0!.options.map((o) => [o.id, o.count]))}
              correct={q0!.kind === "poll" ? [] : q0!.options.filter((o) => o.is_correct).map((o) => o.id)} />
            <AnswerTiles options={q0!.options} big correct={q0!.kind === "poll" ? undefined : q0!.options.filter((o) => o.is_correct).map((o) => o.id)} />
          </div>
        ) : results && isCloud && (s?.responses_visible || results.revealed) ? (
          <div className="w-full max-w-6xl space-y-8 text-center">
            <h2 className="font-display text-5xl font-extrabold leading-tight">{q0!.prompt}</h2>
            <WordCloud words={cloud.data ?? []} dark big />
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
      {state.data && <PresenterControls sessionId={sessionId} state={state.data} slideCount={lesson.data?.slides.length ?? 0} reload={state.reload} />}
    </div>
  );
}

const BAR_BTN = "inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-40";

/**
 * The teacher's controls on the projector: back to the control room, start, slides,
 * reveal, pause, leaderboard, screens and full screen. The bar fades while the mouse
 * is still, so the class sees just the lesson; keys work whether it shows or not:
 * → next, ← back, S start, R reveal, P pause/resume, L leaderboard, F full screen.
 */
function PresenterControls({ sessionId, state, slideCount, reload }: { sessionId: string; state: SessionState; slideCount: number; reload: () => Promise<void> }) {
  const s = state.session;
  const phase = s.phase ?? "active";
  const [shown, setShown] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const hideAt = useRef<number | undefined>(undefined);

  const act = useCallback(async (action: string, args: Record<string, unknown> = {}) => {
    setBusy(true); setErr(null);
    try { await rpc("session_control", { p_session: sessionId, p_action: action, p_args: args }); await reload(); }
    catch (e) { setErr(errorText(e)); }
    finally { setBusy(false); }
  }, [sessionId, reload]);
  const toggleFull = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen().catch(() => {});
  }, []);

  // Show on any movement or key; fade after 3 s of stillness (never in the lobby).
  useEffect(() => {
    const wake = () => {
      setShown(true);
      window.clearTimeout(hideAt.current);
      hideAt.current = window.setTimeout(() => setShown(false), 3000);
    };
    wake();
    const onFull = () => setFull(!!document.fullscreenElement);
    window.addEventListener("pointermove", wake);
    window.addEventListener("keydown", wake);
    window.addEventListener("touchstart", wake);
    document.addEventListener("fullscreenchange", onFull);
    return () => {
      window.clearTimeout(hideAt.current);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("keydown", wake);
      window.removeEventListener("touchstart", wake);
      document.removeEventListener("fullscreenchange", onFull);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.key === "ArrowRight" && phase === "active") { e.preventDefault(); void act("next"); }
      else if (e.key === "ArrowLeft" && phase === "active") { e.preventDefault(); void act("prev"); }
      else if (k === "s" && phase === "lobby") void act("start");
      else if (k === "p" && (phase === "active" || phase === "paused")) void act(phase === "active" ? "pause" : "resume");
      else if (k === "l" && phase !== "lobby") void act("leaderboard", { show: !s.show_leaderboard });
      else if (k === "r" && phase === "active" && state.activity && !state.activity.revealed) void act("reveal");
      else if (k === "f") toggleFull();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, s.show_leaderboard, state.activity, act, toggleFull]);

  const visible = shown || phase === "lobby" || !!err;
  const ghost = `${BAR_BTN} bg-white/10 text-white no-underline hover:bg-white/20`;
  const accent = `${BAR_BTN} bg-accent-400 text-ink-950 hover:bg-accent-300`;
  const mon = state.settings.monitoring_enabled !== false;

  return (
    <div className={`fixed inset-x-0 bottom-0 z-20 transition-opacity duration-300 focus-within:opacity-100 ${visible ? "opacity-100" : "pointer-events-none opacity-0"}`}
      onPointerEnter={() => window.clearTimeout(hideAt.current)}>
      {err && <p role="alert" className="mx-auto mb-2 w-fit rounded-full bg-rose-600 px-4 py-2 text-sm font-medium">{err}</p>}
      <nav aria-label="Presenter controls" className="flex flex-wrap items-center justify-center gap-2 bg-ink-950/90 px-4 py-3 backdrop-blur">
        <Link href={`/teacher/live/${sessionId}`} className={ghost} title="Back to the control room"><ArrowLeft className="h-4 w-4" /> Control room</Link>
        {phase === "lobby" && <button type="button" className={accent} disabled={busy} onClick={() => void act("start")} title="Start the lesson (S)"><Play className="h-4 w-4" /> Start lesson</button>}
        {phase === "active" && <>
          <button type="button" className={ghost} disabled={busy || s.current_slide <= 0} onClick={() => void act("prev")} title="Previous slide (←)"><ChevronLeft className="h-5 w-5" /> Back</button>
          {slideCount > 0 && <span className="px-1 text-sm tabular-nums text-ink-300">{s.current_slide + 1} / {slideCount}</span>}
          <button type="button" className={accent} disabled={busy || (slideCount > 0 && s.current_slide >= slideCount - 1)} onClick={() => void act("next")} title="Next slide (→)">Next <ChevronRight className="h-5 w-5" /></button>
          {state.activity && !state.activity.revealed && <button type="button" className={ghost} disabled={busy} onClick={() => void act("reveal")} title="Show the right answers (R)"><Eye className="h-4 w-4" /> Reveal</button>}
          <button type="button" className={ghost} disabled={busy} onClick={() => void act("pause")} title="Students see “Eyes on your teacher” (P)"><Pause className="h-4 w-4" /> Pause</button>
        </>}
        {phase === "paused" && <button type="button" className={accent} disabled={busy} onClick={() => void act("resume")} title="Carry on (P)"><Play className="h-4 w-4" /> Resume</button>}
        {phase !== "lobby" && state.ranking && <button type="button" className={s.show_leaderboard ? accent : ghost} aria-pressed={!!s.show_leaderboard} disabled={busy}
          onClick={() => void act("leaderboard", { show: !s.show_leaderboard })} title="Leaderboard (L)"><Trophy className="h-4 w-4" /> {s.show_leaderboard ? "Hide leaderboard" : "Leaderboard"}</button>}
        {mon && <Link href={`/teacher/live/${sessionId}?tab=screens`} className={ghost} title="Students’ screens, in the control room (never on the projector)"><LayoutGrid className="h-4 w-4" /> Screens</Link>}
        <button type="button" className={ghost} onClick={toggleFull} title="Full screen (F)">{full ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}{full ? "Exit full screen" : "Full screen"}</button>
      </nav>
    </div>
  );
}
