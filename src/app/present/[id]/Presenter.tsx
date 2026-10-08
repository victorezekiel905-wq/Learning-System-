"use client";
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

  return (
    <div className="flex min-h-screen flex-col bg-ink-900 text-white">
      <header className="flex items-center justify-between px-8 py-4">
        <p className="text-lg font-semibold">{s?.title ?? "SwiftCipher"}</p>
        {s && s.phase !== "lobby" && <p className="text-right text-sm text-ink-300">Join at <strong className="text-white">{host}/join</strong> · code <span className="font-mono text-3xl font-extrabold tracking-[0.2em] text-accent-300">{formatJoinCode(s.join_code)}</span></p>}
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
