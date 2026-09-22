"use client";
import { useEffect, useMemo, useState } from "react";

type RawPayload = Record<string, unknown> | null | undefined;
type Slide = {
  id: string;
  title?: string | null;
  body?: string | null;
  kind?: string | null;
  media_url?: string | null;
  payload?: RawPayload;
};

export default function SlideEditor({ lessonId, initialSlides = [] }: { lessonId: string; initialSlides?: Slide[] }) {
  const normalizedInitialSlides = useMemo(() => initialSlides.map(normalizeSlide), [initialSlides]);
  const [slides, setSlides] = useState<Slide[]>(normalizedInitialSlides);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"html" | "image" | "video">("html");
  const [mediaUrl, setMediaUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    const r = await fetch(`/api/lessons/${lessonId}/slides`);
    if (!r.ok) return;
    const data = await r.json();
    setSlides(Array.isArray(data) ? data.map(normalizeSlide) : []);
  }

  useEffect(() => {
    setSlides(normalizedInitialSlides);
  }, [normalizedInitialSlides]);

  useEffect(() => {
    if (normalizedInitialSlides.length === 0) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lessonId]);

  async function add() {
    if (!title.trim()) {
      setErr("Slide title required.");
      return;
    }
    if ((kind === "image" || kind === "video") && !mediaUrl.trim()) {
      setErr("Media URL required for image and video slides.");
      return;
    }
    setBusy(true);
    setErr(null);
    const r = await fetch(`/api/lessons/${lessonId}/slides`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        body: body.trim(),
        kind,
        index: slides.length,
        media_url: mediaUrl.trim() || null
      })
    });
    setBusy(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setErr(j.error ?? "slide save failed");
      return;
    }
    setTitle("");
    setBody("");
    setMediaUrl("");
    refresh();
  }

  return (
    <div className="space-y-3">
      <div className="card grid grid-cols-1 gap-2 p-4 md:grid-cols-4">
        <input className="input md:col-span-2" placeholder="Slide title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="html">HTML / text</option>
          <option value="image">Image</option>
          <option value="video">Video</option>
        </select>
        <button className="btn btn-primary text-xs" onClick={add} disabled={busy}>{busy ? "Saving…" : "+ Slide"}</button>
        <textarea className="input md:col-span-4 min-h-[80px]" placeholder="Slide body (HTML or text)" value={body} onChange={(e) => setBody(e.target.value)} />
        <input className="input md:col-span-4" placeholder="Optional media URL" value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} />
        {err && <p className="md:col-span-4 text-xs text-rose-600">{err}</p>}
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-slate-500">
        <a className="btn btn-ghost text-xs" href={`/teacher/studio/${lessonId}/video`}>Interactive video timeline</a>
      </div>

      <ul className="space-y-2">
        {slides.map((slide, i) => (
          <li key={String(slide.id)} className="card flex items-center gap-4 p-3">
            <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">#{i + 1}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{slide.title ?? "Untitled"}</p>
              <p className="truncate text-xs text-slate-500">{stripTags(String(slide.body ?? "")).slice(0, 120)}</p>
            </div>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px]">{slide.kind ?? "html"}</span>
          </li>
        ))}
        {slides.length === 0 && <li className="p-4 text-sm text-slate-400">No slides yet. Create the first one above.</li>}
      </ul>
    </div>
  );
}

function normalizeSlide(slide: Slide): Slide {
  const payload = slide.payload ?? {};
  return {
    ...slide,
    title: slide.title ?? String(payload.title ?? payload.heading ?? "Untitled"),
    body: slide.body ?? String(payload.body ?? payload.markdown ?? payload.html ?? payload.subheading ?? ""),
    media_url: slide.media_url ?? String(payload.media_url ?? payload.url ?? ""),
    kind: slide.kind ?? inferKind(payload)
  };
}

function inferKind(payload: RawPayload): string {
  if (!payload) return "html";
  if (typeof payload.url === "string" && String(payload.url).includes(".mp4")) return "video";
  if (typeof payload.url === "string") return "image";
  return "html";
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
