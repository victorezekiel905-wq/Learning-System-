"use client";
import { useRef, useState } from "react";
import type { Stroke } from "@/lib/types";
import { cn } from "@/lib/utils";

const COLORS = ["#0f172a", "#4f46e5", "#0891b2", "#16a34a", "#ea580c", "#dc2626"];

/** Coordinates are stored in a 1000×562.5 (16:9) space so boards scale to any screen. */
export const BOARD_W = 1000;
export const BOARD_H = 562.5;

export function strokePath(s: Stroke) {
  if (!s.points.length) return "";
  const [first, ...rest] = s.points;
  return `M${first![0]},${first![1]}` + rest.map((p) => `L${p[0]},${p[1]}`).join("");
}

export function StrokeLayer({ strokes }: { strokes: Stroke[] }) {
  return (
    <>
      {strokes.map((s, i) => (
        <path key={i} d={strokePath(s)} stroke={s.color} strokeWidth={s.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </>
  );
}

/**
 * Freehand drawing surface used for whiteboard slides, draw activities and
 * live teacher annotation. Pointer events cover mouse, pen and touch.
 */
export function Whiteboard({ strokes, onChange, editable = true, background, className, onStroke }: {
  strokes: Stroke[];
  onChange?: (s: Stroke[]) => void;
  onStroke?: (s: Stroke) => void;
  editable?: boolean;
  background?: React.ReactNode;
  className?: string;
}) {
  const [color, setColor] = useState(COLORS[0]!);
  const [width, setWidth] = useState(4);
  const [erasing, setErasing] = useState(false);
  const current = useRef<Stroke | null>(null);
  const [draft, setDraft] = useState<Stroke | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  function point(e: React.PointerEvent): [number, number] {
    const r = svg.current!.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * BOARD_W), Math.round(((e.clientY - r.top) / r.height) * BOARD_H)];
  }

  return (
    <div className={cn("space-y-2", className)}>
      {editable && (
        <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Drawing tools">
          {COLORS.map((c) => (
            <button key={c} type="button" aria-label={`Colour ${c}`} onClick={() => { setColor(c); setErasing(false); }}
              className={cn("h-6 w-6 rounded-full border-2", color === c && !erasing ? "border-ink-900" : "border-white shadow")} style={{ backgroundColor: c }} />
          ))}
          <select className="input w-auto py-1 text-xs" value={width} onChange={(e) => setWidth(Number(e.target.value))} aria-label="Pen size">
            <option value={2}>Fine</option><option value={4}>Medium</option><option value={8}>Thick</option><option value={16}>Marker</option>
          </select>
          <button type="button" className={cn("btn btn-sm", erasing ? "btn-primary" : "btn-secondary")} onClick={() => setErasing((v) => !v)}>Eraser</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange?.(strokes.slice(0, -1))} disabled={!strokes.length}>Undo</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange?.([])} disabled={!strokes.length}>Clear</button>
        </div>
      )}
      <svg ref={svg} viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} role="img" aria-label="Drawing board"
        className={cn("w-full touch-none select-none rounded-lg border border-ink-200 bg-white", editable && "cursor-crosshair")}
        onPointerDown={(e) => {
          if (!editable) return;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          const p = point(e);
          if (erasing) {
            const remaining = strokes.filter((s) => !s.points.some(([x, y]) => Math.hypot(x - p[0], y - p[1]) < 14));
            if (remaining.length !== strokes.length) onChange?.(remaining);
            return;
          }
          current.current = { color, width, points: [p] };
          setDraft(current.current);
        }}
        onPointerMove={(e) => {
          if (!current.current) return;
          const p = point(e);
          const last = current.current.points[current.current.points.length - 1]!;
          if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 2) return;
          current.current = { ...current.current, points: [...current.current.points, p] };
          setDraft(current.current);
        }}
        onPointerUp={() => {
          if (current.current && current.current.points.length > 1) {
            onChange?.([...strokes, current.current]);
            onStroke?.(current.current);
          }
          current.current = null;
          setDraft(null);
        }}>
        {background}
        <StrokeLayer strokes={strokes} />
        {draft && <StrokeLayer strokes={[draft]} />}
      </svg>
    </div>
  );
}
