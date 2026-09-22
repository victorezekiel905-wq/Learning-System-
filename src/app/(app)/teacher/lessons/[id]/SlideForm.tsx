"use client";
import { useRef, useState } from "react";
import { PickMediaButton } from "@/components/studio/MediaPicker";
import { ShapesSvg } from "@/components/slides/SlideView";
import { BOARD_H, BOARD_W, Whiteboard } from "@/components/slides/Whiteboard";
import { Alert, Button, Card, Field, Input, Textarea } from "@/components/ui";
import type { Shape, SlideContent, SlideKind } from "@/lib/types";
import { uid } from "@/lib/utils";
import { VideoCheckpoints } from "./VideoCheckpoints";

type Props = {
  slide: { id: string; kind: SlideKind; content: SlideContent; notes: string | null };
  lesson: { id: string; tenant_id: string };
  userId: string;
  onChange: (c: SlideContent) => void;
  onNotes: (n: string) => void;
};

export function SlideForm({ slide, lesson, userId, onChange, onNotes }: Props) {
  const c = slide.content ?? {};
  const set = (patch: Partial<SlideContent>) => onChange({ ...c, ...patch });
  const media = (kinds: string[], label: string, field: "media_path" | "captions_path" = "media_path") => (
    <PickMediaButton label={label} kinds={kinds} tenantId={lesson.tenant_id} userId={userId} lessonId={lesson.id}
      onPick={(m) => set(field === "media_path" ? { media_path: m.storage_path, alt: c.alt || m.alt_text || "", label: m.title } : { captions_path: m.storage_path })} />
  );

  return (
    <Card title="Slide content">
      <div className="space-y-4">
        {slide.kind !== "activity" && (
          <Field label="Heading"><Input value={c.heading ?? ""} onChange={(e) => set({ heading: e.target.value })} /></Field>
        )}

        {(slide.kind === "title" || slide.kind === "text" || slide.kind === "link" || slide.kind === "audio" || slide.kind === "attachment") && (
          <Field label={slide.kind === "title" ? "Subtitle" : slide.kind === "audio" ? "Transcript" : "Body"}
            hint={slide.kind === "text" ? "Use '- ' for bullets, **bold**, *italic*, [link](https://…)." : undefined}>
            <Textarea rows={slide.kind === "text" ? 10 : 4} value={c.body ?? ""} onChange={(e) => set({ body: e.target.value })} />
          </Field>
        )}

        {slide.kind === "image" && <>
          <div className="flex gap-2">{media(["image"], c.media_path ? "Replace image" : "Choose image")}</div>
          <Field label="…or image URL (https)"><Input value={c.url ?? ""} onChange={(e) => set({ url: e.target.value, media_path: undefined })} /></Field>
          <Field label="Alt text (required for screen readers)"><Input value={c.alt ?? ""} onChange={(e) => set({ alt: e.target.value })} /></Field>
          {!c.alt && (c.media_path || c.url) && <Alert tone="warn">Add alt text so every student can access this image.</Alert>}
          <Field label="Caption"><Input value={c.caption ?? ""} onChange={(e) => set({ caption: e.target.value })} /></Field>
        </>}

        {slide.kind === "video" && <>
          <div className="flex flex-wrap gap-2">{media(["video"], c.media_path ? "Replace video" : "Upload / choose video")}{media(["document", "other"], c.captions_path ? "Replace captions" : "Captions (.vtt)", "captions_path")}</div>
          <Field label="…or YouTube / Vimeo / .mp4 URL"><Input value={c.url ?? ""} onChange={(e) => set({ url: e.target.value, media_path: undefined })} /></Field>
          <VideoCheckpoints slideId={slide.id} lesson={lesson} userId={userId} directVideo={Boolean(c.media_path || /\.(mp4|webm)(\?|$)/i.test(c.url ?? ""))} />
        </>}

        {slide.kind === "audio" && <div>{media(["audio"], c.media_path ? "Replace audio" : "Choose audio")}</div>}

        {(slide.kind === "embed" || slide.kind === "link") && (
          <Field label="URL (https only)" hint={slide.kind === "embed" ? "Some sites block embedding. Use a Link slide for those." : undefined}>
            <Input value={c.url ?? ""} onChange={(e) => set({ url: e.target.value })} placeholder="https://" />
          </Field>
        )}
        {slide.kind === "link" && <Field label="Button label"><Input value={c.label ?? ""} onChange={(e) => set({ label: e.target.value })} /></Field>}
        {slide.kind === "attachment" && <div>{media(["document", "other", "image", "audio", "video"], c.media_path ? "Replace file" : "Choose file")}</div>}

        {slide.kind === "shapes" && <ShapesEditor shapes={c.shapes ?? []} onChange={(shapes) => set({ shapes })} />}
        {slide.kind === "whiteboard" && (
          <Field label="Pre-drawn board (you can draw more live)">
            <Whiteboard strokes={c.strokes ?? []} onChange={(strokes) => set({ strokes })} />
          </Field>
        )}

        <Field label="Speaker notes (only you see these)"><Textarea rows={3} value={slide.notes ?? ""} onChange={(e) => onNotes(e.target.value)} /></Field>
      </div>
    </Card>
  );
}

const SHAPE_COLORS = ["#4f46e5", "#0891b2", "#16a34a", "#ea580c", "#dc2626", "#0f172a"];

function ShapesEditor({ shapes, onChange }: { shapes: Shape[]; onChange: (s: Shape[]) => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const add = (type: Shape["type"]) => {
    const s: Shape = { id: uid(), type, x: 380, y: 200, w: type === "text" ? 300 : 220, h: type === "text" ? 48 : type === "arrow" ? 60 : 140, color: SHAPE_COLORS[shapes.length % SHAPE_COLORS.length]!, text: type === "text" ? "Label" : undefined };
    onChange([...shapes, s]); setSel(s.id);
  };
  const selected = shapes.find((s) => s.id === sel);
  const pt = (e: React.PointerEvent) => { const r = svg.current!.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * BOARD_W, ((e.clientY - r.top) / r.height) * BOARD_H] as const; };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {(["rect", "ellipse", "arrow", "text"] as const).map((t) => <Button key={t} size="sm" variant="secondary" onClick={() => add(t)}>+ {t}</Button>)}
      </div>
      <svg ref={svg} viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} className="w-full touch-none rounded-lg border border-ink-200 bg-white"
        onPointerMove={(e) => { if (!drag.current) return; const [x, y] = pt(e); onChange(shapes.map((s) => s.id === drag.current!.id ? { ...s, x: Math.round(x - drag.current!.dx), y: Math.round(y - drag.current!.dy) } : s)); }}
        onPointerUp={() => { drag.current = null; }}>
        <ShapesSvg shapes={shapes} />
        {shapes.map((s) => (
          <rect key={s.id} x={s.x} y={s.y} width={s.w} height={s.h} fill="transparent" stroke={s.id === sel ? "#0f172a" : "transparent"} strokeDasharray="6 4" className="cursor-move"
            onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); const [x, y] = pt(e); drag.current = { id: s.id, dx: x - s.x, dy: y - s.y }; setSel(s.id); }} />
        ))}
      </svg>
      {selected && (
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-ink-50 p-2">
          <Field label="Width"><Input type="number" value={selected.w} onChange={(e) => onChange(shapes.map((s) => s.id === sel ? { ...s, w: Number(e.target.value) } : s))} /></Field>
          <Field label="Height"><Input type="number" value={selected.h} onChange={(e) => onChange(shapes.map((s) => s.id === sel ? { ...s, h: Number(e.target.value) } : s))} /></Field>
          {selected.type === "text" && <Field label="Text" className="col-span-2"><Input value={selected.text ?? ""} onChange={(e) => onChange(shapes.map((s) => s.id === sel ? { ...s, text: e.target.value } : s))} /></Field>}
          <div className="col-span-2 flex items-center gap-2">
            {SHAPE_COLORS.map((col) => <button key={col} type="button" aria-label={col} className="h-6 w-6 rounded-full border-2 border-white shadow" style={{ background: col }} onClick={() => onChange(shapes.map((s) => s.id === sel ? { ...s, color: col } : s))} />)}
            <Button size="sm" variant="ghost" className="ml-auto text-rose-600" onClick={() => { onChange(shapes.filter((s) => s.id !== sel)); setSel(null); }}>Remove</Button>
          </div>
        </div>
      )}
    </div>
  );
}
