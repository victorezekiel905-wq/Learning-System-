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
import { RankGrid } from "@/components/live/Leaderboard";
import { GlyphField, Podium } from "@/components/game/Celebrate";
import { JoinQr } from "@/components/live/JoinQr";
import { formatJoinCode } from "@/lib/utils";
import { AnswerBars, AnswerTiles, TimerRing } from "@/components/game/LiveGame";
import { getSound } from "@/lib/sound";
import { useTeacherPresence } from "@/lib/teacher-presence";
import { WordCloud, useWordCloud } from "@/components/game/WordCloud";
import { TeamStandings, useTeamScores } from "@/components/game/Teams";
import { useSessionScreens } from "@/components/live/ScreenRail";
import { useToast } from "@/components/ui";
import { liveFrame, ProjectedScreen, ScreenStrip } from "./PresentScreens";
import { usePresenceAlarms } from "@/components/live/presence-alarms";
import { useSlideNav, type SlideNav } from "@/lib/slide-nav";
import { useLiveState } from "@/lib/live-state";

const TILE_KINDS = ["mcq", "true_false", "poll", "multi_select"];

export function Presenter({ sessionId }: { sessionId: string }) {
  useTeacherPresence(sessionId);
  // In step with students: the lesson broadcast and each button's reply move this screen at
  // once; the full state follows (with retries).
  const state = useLiveState(sessionId, { intervalMs: 15000 });
  const lesson = useLoader(() => rpc<{ slides: SlideData[] }>("session_lesson", { p_session: sessionId }), [sessionId]);
  const spotOn = !!state.data?.spotlight?.show_to_class;
  const spotQ = useRpc<{ student: string; image: string | null; stale: boolean } | null>("spotlight_view", { p_session: sessionId }, [sessionId], { intervalMs: 3000, enabled: spotOn });
  // A paused query keeps its last answer: only trust it while a class spotlight is on.
  const spot = { data: spotOn ? spotQ.data : null, reload: spotQ.reload };
  useSignal(`staff:${sessionId}`, ["state"], () => { void state.reload(); void spot.reload(); }, { debounceMs: 100 });
  // Joins, leaves and hands, for the screens beside the lesson.
  useSignal(`staff:${sessionId}`, ["roster", "alert", "hand"], () => void state.reload(), { debounceMs: 300, minGapMs: 1500 });
  const s = state.data?.session;
  const toast = useToast();
  const slides = lesson.data?.slides ?? [];
  // Next/back show at once; the server (and the students) catch up in the background.
  const nav = useSlideNav(sessionId, s?.current_slide ?? 0, slides.length, state.reload, (e) => toast(errorText(e), "error"), state.take);
  const ann = useAnnotations(sessionId, nav.slide);
  const slide = slides.find((x) => x.position === nav.slide);
  // Joining, leaving and coming back pop up here too.
  usePresenceAlarms(state.data?.roster, true, !!s && s.phase !== "lobby");
  const results = state.data?.activity;
  const isCloud = results?.questions[0]?.kind === "word_cloud";
  const cloud = useWordCloud(results?.activity.id, sessionId, isCloud);
  const teamsOn = (state.data?.session.settings?.teams ?? 0) >= 2;
  const teams = useTeamScores(sessionId, state.data?.session.leaderboard?.at, teamsOn && !!state.data?.session.show_leaderboard);
  const host = typeof window !== "undefined" ? window.location.host : "";
  const here = (state.data?.roster ?? []).filter((r) => r.presence === "online" || r.presence === "idle");

  // Every student's lesson view beside the lesson. Real screens are used only where a
  // student happens to share theirs (and the school allows capture).
  const captureOk = !!state.data && state.data.settings.monitoring_enabled !== false && !!state.data.settings.allow_screen_capture;
  const screens = useSessionScreens(sessionId, captureOk ? state.data : null);
  const [railOn, setRailOn] = useState(true);
  useEffect(() => { try { if (localStorage.getItem("swiftcipher.present.screens") === "off") setRailOn(false); } catch { /* storage blocked */ } }, []);
  const toggleRail = useCallback(() => setRailOn((v) => {
    try { localStorage.setItem("swiftcipher.present.screens", v ? "off" : "on"); } catch { /* storage blocked */ }
    return !v;
  }), []);
  const rail = railOn && !!s && s.phase !== "lobby";
  // The student shown large on this screen; everyone else's device keeps the lesson.
  // Their lesson view needs nothing from them. A real shared screen goes up as a
  // spotlight just for the projector, so the student is told.
  const [shown, setShown] = useState<string | null>(null);
  const shownRef = useRef<string | null>(null);
  shownRef.current = shown;
  const spotlit = useRef(false);
  const hideScreen = useCallback(() => {
    if (!shownRef.current) return;
    setShown(null);
    if (spotlit.current) {
      spotlit.current = false;
      void rpc("spotlight_stop", { p_session: sessionId }).catch(() => {}).then(() => state.reload());
    }
  }, [sessionId, state]);
  const showScreen = useCallback(async (id: string) => {
    if (shownRef.current === id) { hideScreen(); return; }
    const r = state.data?.roster.find((x) => x.student_id === id);
    if (r && liveFrame(r, screens)) {
      try {
        await rpc("spotlight_start", { p_session: sessionId, p_student: id, p_anonymized: false, p_show_to_class: false });
        spotlit.current = true;
        await state.reload();
        setShown(id);
      } catch (e) { toast(errorText(e), "error"); }
      return;
    }
    if (spotlit.current) { spotlit.current = false; void rpc("spotlight_stop", { p_session: sessionId }).catch(() => {}); }
    setShown(id);
  }, [sessionId, state, screens, toast, hideScreen]);
  // A shared screen stopped from the control room: back to the lesson.
  const spotStudent = state.data?.spotlight?.student_id ?? null;
  useEffect(() => {
    if (spotlit.current && shown && state.data && spotStudent !== shown) { spotlit.current = false; setShown(null); }
  }, [shown, spotStudent, state.data]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && shownRef.current) hideScreen(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hideScreen]);
  // Leaving Present ends the projector's spotlight.
  useEffect(() => () => { if (spotlit.current) void rpc("spotlight_stop", { p_session: sessionId }).catch(() => {}); }, [sessionId]);

  // Clock skew against the server, so the projector counts down with the phones.
  const [skew, setSkew] = useState(0);
  useEffect(() => { if (state.data?.server_now) setSkew(new Date(state.data.server_now).getTime() - Date.now()); }, [state.data]);
  const timer = state.data?.timer ?? null;
  const q0 = results?.questions[0];
  const gameOn = s?.phase === "active" && !s.show_leaderboard && !spot.data && !shown && !nav.pending && !!results && !!q0;
  const asking = gameOn && !results!.revealed && !s.responses_visible;
  const revealedTiles = gameOn && results!.revealed && TILE_KINDS.includes(q0!.kind);
  const revealedOther = gameOn && results!.revealed && !TILE_KINDS.includes(q0!.kind) && !isCloud;
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
      <div className="flex flex-1 flex-col lg:flex-row">
      <main className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden p-4 sm:p-6">
        {s?.phase === "lobby" && <GlyphField opacity={0.4} />}
        {shown && state.data && s && s.phase !== "lobby" ? (
          <ProjectedScreen state={state.data} sessionId={sessionId} studentId={shown} onBack={hideScreen}
            screens={screens} slides={slides} slide={nav.slide}
            lesson={slide ? <SlideView slide={slide} /> : undefined}
            lessonLabel={s.phase === "paused" ? "Lesson paused" : `Lesson · slide ${nav.slide + 1}${slides.length ? ` of ${slides.length}` : ""}`} />
        ) : s?.phase === "lobby" ? (
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
          // Everyone, not just the top few: the podium, then every other player in columns
          // (the board scrolls when a big class doesn't fit).
          <div className="max-h-[calc(100dvh-10rem)] w-full max-w-6xl overflow-y-auto px-1" key={s.leaderboard.at ?? "board"}>
            <h2 className="mb-8 text-center font-display text-4xl font-extrabold sm:text-6xl">Leaderboard</h2>
            {teamsOn && (teams.data ?? []).length > 0 && <div className="mx-auto mb-10 max-w-3xl"><TeamStandings teams={teams.data!} big /></div>}
            <Podium entries={s.leaderboard.top.slice(0, 3)} />
            <div className="mt-8"><RankGrid entries={s.leaderboard.top.slice(3)} /></div>
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
          // Fits above the controls: the bars, then the answers (compact) with the right one marked.
          <div className="w-full max-w-5xl space-y-6 text-center">
            <h2 className="font-display text-3xl font-extrabold leading-tight sm:text-4xl">{q0!.prompt}</h2>
            {/* The bar chart only where there is room (tall screens); the tiles carry the counts too. */}
            <div className="hidden [@media(min-height:900px)]:block">
              <AnswerBars options={q0!.options} counts={Object.fromEntries(q0!.options.map((o) => [o.id, o.count]))}
                correct={q0!.kind === "poll" ? [] : q0!.options.filter((o) => o.is_correct).map((o) => o.id)} />
            </div>
            <AnswerTiles options={q0!.options} counts={Object.fromEntries(q0!.options.map((o) => [o.id, o.count]))}
              correct={q0!.kind === "poll" ? undefined : q0!.options.filter((o) => o.is_correct).map((o) => o.id)} />
          </div>
        ) : revealedOther ? (
          // Written answers, ordering, matching, labelling: how many got it right, and the answer.
          <div className="w-full max-w-4xl space-y-8 text-center">
            <h2 className="font-display text-3xl font-extrabold leading-tight sm:text-5xl">{q0!.prompt}</h2>
            <p className="font-display text-7xl font-extrabold tabular-nums text-accent-400">{q0!.responses ? Math.round((100 * q0!.correct) / q0!.responses) : 0}%</p>
            <p className="text-2xl text-ink-300">{q0!.correct} of {q0!.responses} got it right</p>
            {q0!.options.some((o) => o.is_correct) && (
              <div className="mx-auto max-w-2xl rounded-2xl bg-white/[0.07] p-5 ring-1 ring-inset ring-white/10">
                <p className="text-sm font-semibold uppercase tracking-wide text-ink-300">Answer</p>
                <p className="mt-2 text-3xl font-bold">{q0!.options.filter((o) => o.is_correct).map((o) => o.label).join(", ")}</p>
              </div>
            )}
          </div>
        ) : results && isCloud && !nav.pending && (s?.responses_visible || results.revealed) ? (
          <div className="w-full max-w-6xl space-y-8 text-center">
            <h2 className="font-display text-5xl font-extrabold leading-tight">{q0!.prompt}</h2>
            <WordCloud words={cloud.data ?? []} dark big />
          </div>
        ) : results && s?.responses_visible && !nav.pending ? (
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
      {rail && state.data && <ScreenStrip state={state.data} screens={screens} slides={slides} slide={nav.slide} shown={shown} onShow={(id) => void showScreen(id)} onHide={toggleRail} />}
      </div>
      {state.error && <p role="status" className="fixed left-1/2 top-3 z-30 -translate-x-1/2 rounded-full bg-amber-400 px-3 py-1 text-xs font-semibold text-ink-950">Reconnecting… your screen may be a moment behind</p>}
      {state.data && <PresenterControls sessionId={sessionId} state={state.data} slideCount={slides.length} reload={state.reload} take={state.take} nav={nav} questionSlide={slide?.kind === "activity"}
        screens={{ on: railOn, toggle: toggleRail }} />}
    </div>
  );
}

const BAR_BTN = "inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-40";

/**
 * The teacher's controls on the projector: back to the control room, start, slides,
 * reveal, pause, leaderboard, screens and full screen. The bar fades while the mouse
 * is still, so the class sees just the lesson; keys work whether it shows or not:
 * → next, ← back, S start, R reveal, P pause/resume, L leaderboard, V screens,
 * F full screen, Esc back to the lesson from a student's screen.
 */
function PresenterControls({ sessionId, state, slideCount, reload, take, nav, screens, questionSlide }: {
  sessionId: string; state: SessionState; slideCount: number; reload: () => Promise<void>; take: (r: unknown) => void; nav: SlideNav;
  /** The slide on screen holds a question (known from the lesson, before its results arrive). */
  questionSlide: boolean;
  /** Students' screens beside the lesson. */
  screens: { on: boolean; toggle: () => void } | null;
}) {
  const s = state.session;
  const phase = s.phase ?? "active";
  // Reveal as soon as the question is on screen, even if its results are still loading:
  // the server reveals the question on the current slide.
  const canReveal = state.activity ? !state.activity.revealed : questionSlide && !nav.pending;
  const [shown, setShown] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const hideAt = useRef<number | undefined>(undefined);

  const act = useCallback(async (action: string, args: Record<string, unknown> = {}) => {
    setBusy(true); setErr(null);
    try {
      // The reply (phase, slide, version) moves this screen at once; the refresh brings results and the board.
      take(await rpc("session_control", { p_session: sessionId, p_action: action, p_args: args }));
      await reload();
    } catch (e) { setErr(errorText(e)); }
    finally { setBusy(false); }
  }, [sessionId, reload, take]);
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
      if (e.key === "ArrowRight" && phase === "active") { e.preventDefault(); nav.next(); }
      else if (e.key === "ArrowLeft" && phase === "active") { e.preventDefault(); nav.prev(); }
      else if (k === "s" && phase === "lobby") void act("start");
      else if (k === "p" && (phase === "active" || phase === "paused")) void act(phase === "active" ? "pause" : "resume");
      else if (k === "l" && phase !== "lobby") void act("leaderboard", { show: !s.show_leaderboard });
      else if (k === "r" && phase === "active" && canReveal) void act("reveal");
      else if (k === "f") toggleFull();
      else if (k === "v" && screens && phase !== "lobby") screens.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, s.show_leaderboard, canReveal, act, toggleFull, screens, nav]);

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
          <button type="button" className={ghost} disabled={nav.atStart} onClick={nav.prev} title="Previous slide (←)"><ChevronLeft className="h-5 w-5" /> Back</button>
          {slideCount > 0 && <span className="px-1 text-sm tabular-nums text-ink-300">{nav.slide + 1} / {slideCount}</span>}
          <button type="button" className={accent} disabled={nav.atEnd} onClick={nav.next} title="Next slide (→)">Next <ChevronRight className="h-5 w-5" /></button>
          {canReveal && <button type="button" className={ghost} disabled={busy} onClick={() => void act("reveal")} title="Show the right answers (R)"><Eye className="h-4 w-4" /> Reveal</button>}
          <button type="button" className={ghost} disabled={busy} onClick={() => void act("pause")} title="Students see “Eyes on your teacher” (P)"><Pause className="h-4 w-4" /> Pause</button>
        </>}
        {phase === "paused" && <button type="button" className={accent} disabled={busy} onClick={() => void act("resume")} title="Carry on (P)"><Play className="h-4 w-4" /> Resume</button>}
        {phase !== "lobby" && state.ranking && <button type="button" className={s.show_leaderboard ? accent : ghost} aria-pressed={!!s.show_leaderboard} disabled={busy}
          onClick={() => void act("leaderboard", { show: !s.show_leaderboard })} title="Leaderboard (L)"><Trophy className="h-4 w-4" /> {s.show_leaderboard ? "Hide leaderboard" : "Leaderboard"}</button>}
        {screens && phase !== "lobby" ? <button type="button" className={screens.on ? accent : ghost} aria-pressed={screens.on} onClick={screens.toggle} title="Students’ screens beside the lesson (V)"><LayoutGrid className="h-4 w-4" /> {screens.on ? "Hide screens" : "Screens"}</button>
          : mon && <Link href={`/teacher/live/${sessionId}?tab=screens`} className={ghost} title="Students’ screens, in the control room"><LayoutGrid className="h-4 w-4" /> Screens</Link>}
        <button type="button" className={ghost} onClick={toggleFull} title="Full screen (F)">{full ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}{full ? "Exit full screen" : "Full screen"}</button>
      </nav>
    </div>
  );
}
