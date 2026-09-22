"use client";
import { use, useEffect, useRef, useState } from "react";

// §3.1 — Interactive video: a YouTube/HTML5 <video> URL plus a list of
// questions fired at fixed seconds; on playback the player surfaces them.
export default function VideoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [videoUrl, setVideoUrl] = useState("");
  const [stamps, setStamps] = useState<Array<{ id: string; t_seconds: number; kind: string; payload: Record<string, unknown> }>>([]);
  const [t, setT] = useState(0);
  const [draftTs, setDraftTs] = useState({ t_seconds: 30, kind: "question", text: "" });
  const ref = useRef<HTMLVideoElement | null>(null);

  async function refresh() {
    const r = await fetch(`/api/video-timestamps?lesson_id=${id}`);
    if (r.ok) setStamps(await r.json());
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [id]);

  async function addStamp() {
    const body = {
      lesson_id: id,
      video_url: videoUrl || "https://example.com/video.mp4",
      t_seconds: draftTs.t_seconds,
      kind: draftTs.kind,
      payload: { text: draftTs.text }
    };
    const r = await fetch("/api/video-timestamps", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
    });
    if (r.ok) refresh();
  }

  // When current playback crosses a timestamp, surface it inline.
  const crossed = stamps.find(s => s.kind === "question" && Math.abs(t - s.t_seconds) < 1);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <p className="text-sm font-medium text-brand-600">Fusion Studio · Interactive Video</p>
        <h1 className="text-2xl font-semibold">Timestamped questions + notes</h1>
        <p className="mt-1 text-sm text-slate-600">Paste a video URL (mp4 or HLS). Add a question or note at any second; students in live mode will see a prompt when playback crosses that timestamp.</p>
      </header>

      <section className="card p-5">
        <label className="label">Video URL</label>
        <input className="input" placeholder="https://…/video.mp4" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} />
        <video ref={ref} className="mt-4 max-h-[420px] w-full rounded-lg bg-black" controls src={videoUrl || undefined}
               onTimeUpdate={(e) => setT((e.target as HTMLVideoElement).currentTime)} />
        <p className="mt-2 text-xs text-slate-500">Now: {Math.floor(t)}s</p>

        {crossed && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
            ⏱ {(crossed.payload as { text?: string }).text ?? "Question"} — fired at {crossed.t_seconds}s
          </div>
        )}
      </section>

      <section className="card mt-6 p-5">
        <h2 className="text-lg font-semibold">Add a timestamp</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label className="label">Second</label>
            <input className="input" type="number" min={0} value={draftTs.t_seconds}
                   onChange={(e) => setDraftTs({ ...draftTs, t_seconds: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Kind</label>
            <select className="input" value={draftTs.kind}
                    onChange={(e) => setDraftTs({ ...draftTs, kind: e.target.value })}>
              <option value="question">Question (live prompt)</option>
              <option value="note">Note (annotation)</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Text</label>
            <input className="input" value={draftTs.text}
                   onChange={(e) => setDraftTs({ ...draftTs, text: e.target.value })} />
          </div>
        </div>
        <button className="btn btn-primary mt-4 text-xs" onClick={addStamp}>+ Add timestamp</button>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Timeline</h2>
        <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {stamps.length === 0 && <li className="p-4 text-sm text-slate-400">No timestamps yet.</li>}
          {stamps.map((s) => (
            <li key={s.id} className="flex items-center gap-4 p-3 text-sm">
              <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">{s.t_seconds}s</span>
              <span className={"rounded-full px-2 py-0.5 text-[10px] " + (s.kind === "question" ? "bg-amber-100 text-amber-700" : "bg-sky-100 text-sky-700")}>{s.kind}</span>
              <span className="flex-1 truncate text-slate-700">{(s.payload as { text?: string }).text ?? ""}</span>
              <button className="text-xs text-slate-500 hover:text-slate-900" onClick={() => ref.current && (ref.current.currentTime = s.t_seconds)}>seek</button>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
