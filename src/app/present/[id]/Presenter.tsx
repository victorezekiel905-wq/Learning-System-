"use client";
import { SlideView, type SlideData } from "@/components/slides/SlideView";
import { BOARD_H, BOARD_W, StrokeLayer } from "@/components/slides/Whiteboard";
import type { SessionState } from "@/components/live/types";
import { useAnnotations } from "@/lib/annotations";
import { useLoader, useRpc } from "@/lib/hooks";
import { useSignal } from "@/lib/realtime";
import { rpc } from "@/lib/rpc";

export function Presenter({ sessionId }: { sessionId: string }) {
  const state = useRpc<SessionState>("teacher_session_state", { p_session: sessionId }, [sessionId], { intervalMs: 15000 });
  const lesson = useLoader(() => rpc<{ slides: SlideData[] }>("session_lesson", { p_session: sessionId }), [sessionId]);
  const spot = useRpc<{ student: string; image: string | null; stale: boolean } | null>("spotlight_view", { p_session: sessionId }, [sessionId], { intervalMs: 3000, enabled: !!state.data?.spotlight?.show_to_class });
  useSignal(`staff:${sessionId}`, ["state"], () => { void state.reload(); void spot.reload(); }, { debounceMs: 100 });
  const s = state.data?.session;
  const ann = useAnnotations(sessionId, s?.current_slide ?? 0);
  const slide = (lesson.data?.slides ?? []).find((x) => x.position === s?.current_slide);
  const results = state.data?.activity;

  return (
    <div className="flex min-h-screen flex-col bg-ink-900 text-white">
      <header className="flex items-center justify-between px-8 py-4">
        <p className="text-lg font-semibold">{s?.title ?? "SwiftCipher"}</p>
        {s && <p className="text-right text-sm text-ink-300">Join at <strong className="text-white">{typeof window !== "undefined" ? window.location.host : ""}/student/join</strong> · code <span className="font-mono text-3xl font-extrabold tracking-[0.2em] text-accent-300">{s.join_code}</span></p>}
      </header>
      <main className="flex flex-1 items-center justify-center p-6">
        {spot.data ? (
          <figure className="w-full max-w-6xl">
            {spot.data.image && !spot.data.stale ? <img src={spot.data.image} alt={`Spotlight: ${spot.data.student}`} className="w-full rounded-xl" />
              : <div className="grid aspect-video place-items-center rounded-xl bg-ink-800 text-ink-400">Screen unavailable</div>}
            <figcaption className="mt-3 text-center text-xl font-semibold">⭐ {spot.data.student}</figcaption>
          </figure>
        ) : results && s?.responses_visible ? (
          <div className="w-full max-w-4xl space-y-6">
            <h2 className="text-3xl font-bold">{results.activity.title}</h2>
            {results.questions.slice(0, 1).map((q) => (
              <div key={q.question_id} className="space-y-4">
                <p className="text-2xl">{q.prompt}</p>
                {q.options.map((o) => (
                  <div key={o.id}>
                    <div className="mb-1 flex justify-between text-lg"><span>{o.label}</span><span>{o.count}</span></div>
                    <div className="h-6 rounded-full bg-ink-700"><div className="h-full rounded-full bg-accent-400" style={{ width: `${(100 * o.count) / Math.max(q.responses, 1)}%` }} /></div>
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
