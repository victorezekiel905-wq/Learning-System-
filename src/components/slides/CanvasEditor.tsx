"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlignCenter, AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignLeft, AlignRight,
  AlignStartHorizontal, AlignStartVertical, ArrowDown, ArrowUp, Bold, BringToFront, Circle, Copy, Diamond, ImagePlus, Italic, List,
  Minus, MoveRight, Redo2, RectangleHorizontal, SendToBack, Shapes, Square, Star, Trash2, Triangle, Type, Underline, Undo2
} from "lucide-react";
import { MediaPicker } from "@/components/studio/MediaPicker";
import { Alert, Field, Input, Select, Textarea, useToast } from "@/components/ui";
import { signedUrl, uploadMedia } from "@/lib/media";
import { errorText } from "@/lib/rpc";
import type { SlideContent } from "@/lib/types";
import { cn, uid } from "@/lib/utils";
import {
  canvasHeading, cleanCanvas, FONTS, isColor, MAX_ELEMENTS, newImage, newShape, newText, PALETTE, SIZES, STAGE_H, STAGE_W,
  type CanvasElement, type ImageElement, type ShapeElement, type ShapeKind, type TextElement
} from "@/slides/canvas";
import { boxStyle, CanvasView, textStyle } from "./CanvasView";

type Doc = ReturnType<typeof cleanCanvas>;
type Drag =
  | { mode: "move"; start: CanvasElement; px: number; py: number; before: Doc; moved: boolean }
  | { mode: "resize"; start: CanvasElement; px: number; py: number; hx: number; hy: number; before: Doc; moved: boolean }
  | { mode: "rotate"; start: CanvasElement; before: Doc; moved: boolean };

/** Copied element, shared between slides of the lesson. */
let copied: CanvasElement | null = null;

const SHAPES: { shape: ShapeKind; label: string; icon: ReactNode }[] = [
  { shape: "rect", label: "Rectangle", icon: <Square className="h-4 w-4" /> },
  { shape: "round", label: "Rounded rectangle", icon: <RectangleHorizontal className="h-4 w-4" /> },
  { shape: "ellipse", label: "Circle", icon: <Circle className="h-4 w-4" /> },
  { shape: "triangle", label: "Triangle", icon: <Triangle className="h-4 w-4" /> },
  { shape: "diamond", label: "Diamond", icon: <Diamond className="h-4 w-4" /> },
  { shape: "star", label: "Star", icon: <Star className="h-4 w-4" /> },
  { shape: "line", label: "Line", icon: <Minus className="h-4 w-4" /> },
  { shape: "arrow", label: "Arrow", icon: <MoveRight className="h-4 w-4" /> }
];
const HANDLES: [number, number][] = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];
const CURSOR: Record<string, string> = { "-1-1": "nwse-resize", "11": "nwse-resize", "1-1": "nesw-resize", "-11": "nesw-resize", "0-1": "ns-resize", "01": "ns-resize", "-10": "ew-resize", "10": "ew-resize" };
const isFlat = (e: CanvasElement) => e.type === "shape" && (e.shape === "line" || e.shape === "arrow");
const round = (e: CanvasElement): CanvasElement => ({ ...e, x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.w), h: Math.round(e.h), rotate: Math.round(e.rotate ?? 0) });

/**
 * Nearpod-style slide designer: text boxes, pictures and shapes placed freely on
 * a 16:9 slide. Changes go to `onChange` (the lesson editor saves them).
 */
export function CanvasEditor({ content, notes, lesson, userId, onChange, onNotes }: {
  content: SlideContent; notes: string | null; lesson: { id: string; tenant_id: string }; userId: string;
  onChange: (c: SlideContent) => void; onNotes: (n: string) => void;
}) {
  const toast = useToast();
  const [doc, setDoc] = useState<Doc>(() => cleanCanvas(content));
  const docRef = useRef(doc);
  const [sel, setSel] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const [picker, setPicker] = useState<null | { target: "new" | "background" | string }>(null);
  const [shapesOpen, setShapesOpen] = useState(false);
  const [, setTick] = useState(0);
  const past = useRef<Doc[]>([]);
  const future = useRef<Doc[]>([]);
  const lastKey = useRef<{ k: string; t: number } | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const editBefore = useRef<Doc | null>(null);

  const selected = doc.elements.find((e) => e.id === sel) ?? null;

  function emit(next: Doc) {
    onChange({ ...content, background: next.background, elements: next.elements, heading: canvasHeading(next.elements) || undefined });
  }
  function live(next: Doc) { docRef.current = next; setDoc(next); }
  /** Saves a change and records it for undo; changes with the same key within a second undo together. */
  function commit(next: Doc, key?: string, before: Doc = docRef.current) {
    const now = Date.now();
    if (!(key && lastKey.current?.k === key && now - lastKey.current.t < 1000)) {
      past.current.push(before);
      if (past.current.length > 100) past.current.shift();
    }
    lastKey.current = key ? { k: key, t: now } : null;
    future.current = [];
    live(next); emit(next); setTick((t) => t + 1);
  }
  const withEl = (d: Doc, id: string, patch: Partial<CanvasElement>): Doc =>
    ({ ...d, elements: d.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as CanvasElement) : e)) });
  const update = (id: string, patch: Partial<CanvasElement>, key?: string) => commit(withEl(docRef.current, id, patch), key ?? `${id}:${Object.keys(patch).join()}`);
  const setBg = (patch: Partial<Doc["background"]>, key?: string) => commit({ ...docRef.current, background: { ...docRef.current.background, ...patch } }, key);

  function undo() {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(docRef.current);
    lastKey.current = null; setEditing(null);
    live(prev); emit(prev); setTick((t) => t + 1);
  }
  function redo() {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(docRef.current);
    lastKey.current = null;
    live(next); emit(next); setTick((t) => t + 1);
  }

  function add(e: CanvasElement, edit = false) {
    if (docRef.current.elements.length >= MAX_ELEMENTS) { toast(`A slide can hold up to ${MAX_ELEMENTS} items.`, "error"); return; }
    commit({ ...docRef.current, elements: [...docRef.current.elements, e] });
    setSel(e.id);
    if (edit) startEditing(e.id);
  }
  function remove(id: string) {
    commit({ ...docRef.current, elements: docRef.current.elements.filter((e) => e.id !== id) });
    setSel(null); setEditing(null);
  }
  function duplicate(e: CanvasElement) { add({ ...e, id: uid(), x: e.x + 32, y: e.y + 32 }); }
  function layer(id: string, to: "front" | "back" | "up" | "down") {
    const els = [...docRef.current.elements];
    const i = els.findIndex((e) => e.id === id);
    if (i < 0) return;
    const [e] = els.splice(i, 1);
    const j = to === "front" ? els.length : to === "back" ? 0 : to === "up" ? Math.min(i + 1, els.length) : Math.max(i - 1, 0);
    els.splice(j, 0, e!);
    commit({ ...docRef.current, elements: els });
  }
  function alignTo(e: CanvasElement, where: "left" | "center" | "right" | "top" | "middle" | "bottom") {
    const p = where === "left" ? { x: 0 } : where === "center" ? { x: (STAGE_W - e.w) / 2 } : where === "right" ? { x: STAGE_W - e.w }
      : where === "top" ? { y: 0 } : where === "middle" ? { y: (STAGE_H - e.h) / 2 } : { y: STAGE_H - e.h };
    update(e.id, p);
  }

  // ---- pictures -------------------------------------------------------------
  async function placePicture(path: string, alt: string, target: "new" | "background" | string) {
    if (target === "background") { setBg({ media_path: path, alt, fit: docRef.current.background.fit ?? "cover" }); return; }
    const existing = docRef.current.elements.find((e) => e.id === target);
    if (existing) { update(existing.id, { media_path: path, url: undefined, alt: alt || (existing as ImageElement).alt }); return; }
    // Size the new picture to its own shape, at most 900 x 600.
    let w = 800, h = 600;
    try {
      const url = await signedUrl(path);
      if (url) {
        const img = new Image();
        await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(new Error("load")); img.src = url; });
        const k = Math.min(900 / img.naturalWidth, 600 / img.naturalHeight, 1.5);
        w = Math.round(img.naturalWidth * k); h = Math.round(img.naturalHeight * k);
      }
    } catch { /* keep the default size */ }
    add(newImage({ media_path: path, alt, w, h, x: Math.round((STAGE_W - w) / 2), y: Math.round((STAGE_H - h) / 2), fit: "contain" }));
  }
  async function uploadFile(file: File) {
    if (!file.type.startsWith("image/")) { toast("Only pictures can be dropped onto a slide.", "error"); return; }
    try {
      const m = await uploadMedia(file, { tenantId: lesson.tenant_id, userId, lessonId: lesson.id });
      await placePicture(m.storage_path, "", "new");
      toast("Picture added. Describe it under Alt text so every student can follow.", "info");
    } catch (e) { toast(errorText(e), "error"); }
  }

  // ---- pointer: move, resize, rotate ---------------------------------------
  function toStage(clientX: number, clientY: number) {
    const r = stage.current!.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * STAGE_W, y: ((clientY - r.top) / r.height) * STAGE_H, unit: STAGE_W / r.width };
  }

  function snapMove(e: CanvasElement, x: number, y: number, thr: number) {
    const xs = [0, STAGE_W / 2, STAGE_W], ys = [0, STAGE_H / 2, STAGE_H];
    for (const o of docRef.current.elements) {
      if (o.id === e.id || o.rotate) continue;
      xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h);
    }
    let gx: number | null = null, gy: number | null = null, bx = thr, by = thr, nx = x, ny = y;
    for (const t of xs) for (const off of [0, e.w / 2, e.w]) { const d = Math.abs(x + off - t); if (d < bx) { bx = d; gx = t; nx = t - off; } }
    for (const t of ys) for (const off of [0, e.h / 2, e.h]) { const d = Math.abs(y + off - t); if (d < by) { by = d; gy = t; ny = t - off; } }
    return { x: nx, y: ny, gx, gy };
  }

  function begin(ev: React.PointerEvent, d: Drag) {
    ev.preventDefault(); ev.stopPropagation();
    setShapesOpen(false);
    const onMove = (m: PointerEvent) => {
      const p = toStage(m.clientX, m.clientY);
      const s = d.start;
      let patch: Partial<CanvasElement> = {};
      if (d.mode === "move") {
        let x = s.x + p.x - d.px, y = s.y + p.y - d.py;
        if (!d.moved && Math.hypot(p.x - d.px, p.y - d.py) < 2 * p.unit) return;
        if (!m.altKey && !s.rotate) {
          const sn = snapMove(s, x, y, 7 * p.unit);
          x = sn.x; y = sn.y; setGuides({ x: sn.gx, y: sn.gy });
        }
        patch = { x, y };
      } else if (d.mode === "resize") {
        const th = ((s.rotate ?? 0) * Math.PI) / 180, cos = Math.cos(th), sin = Math.sin(th);
        const dx = p.x - d.px, dy = p.y - d.py;
        const lx = dx * cos + dy * sin, ly = -dx * sin + dy * cos;
        let w = s.w + d.hx * lx, h = s.h + d.hy * ly;
        const keep = d.hx !== 0 && d.hy !== 0 && (s.type === "image" ? !m.shiftKey : m.shiftKey);
        if (keep) { const k = Math.max(w / s.w, h / s.h); w = s.w * k; h = s.h * k; }
        w = Math.max(w, 16); h = Math.max(h, isFlat(s) ? 8 : 16);
        const sx = (d.hx * (w - s.w)) / 2, sy = (d.hy * (h - s.h)) / 2;
        const cx = s.x + s.w / 2 + sx * cos - sy * sin, cy = s.y + s.h / 2 + sx * sin + sy * cos;
        patch = { x: cx - w / 2, y: cy - h / 2, w, h };
      } else {
        const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
        let a = (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI + 90;
        if (m.shiftKey) a = Math.round(a / 15) * 15;
        else if (Math.abs(a - Math.round(a / 45) * 45) < 4) a = Math.round(a / 45) * 45;
        if (a > 180) a -= 360;
        patch = { rotate: a };
      }
      d.moved = true;
      live(withEl(docRef.current, s.id, patch));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setGuides({ x: null, y: null });
      if (!d.moved) return;
      const el = docRef.current.elements.find((e) => e.id === d.start.id);
      commit(el ? withEl(docRef.current, el.id, round(el)) : docRef.current, undefined, d.before);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }
  const pointAt = (ev: React.PointerEvent) => toStage(ev.clientX, ev.clientY);
  function grab(ev: React.PointerEvent, e: CanvasElement) {
    if (ev.button !== 0) return;
    setSel(e.id);
    if (editing && editing !== e.id) setEditing(null);
    const p = pointAt(ev);
    begin(ev, { mode: "move", start: e, px: p.x, py: p.y, before: docRef.current, moved: false });
  }

  // ---- typing into a text box ----------------------------------------------
  function startEditing(id: string) { editBefore.current = docRef.current; setSel(id); setEditing(id); }
  function finishEditing(id: string, text: string) {
    const before = editBefore.current ?? docRef.current;
    const was = before.elements.find((e) => e.id === id) as TextElement | undefined;
    setEditing(null);
    if (was && was.text === text) { live(withEl(docRef.current, id, { text })); return; }
    commit(withEl(docRef.current, id, { text }), undefined, before);
  }

  // ---- keyboard and clipboard ----------------------------------------------
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  const paste = useRef<(e: ClipboardEvent) => void>(() => {});
  const mine = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    if (picker || editing) return false;
    if (el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable)) return false;
    return !el || el === document.body || !!root.current?.contains(el);
  };
  useEffect(() => {
    keys.current = (ev) => {
      if (!mine(ev.target)) return;
      const mod = ev.ctrlKey || ev.metaKey;
      const k = ev.key.toLowerCase();
      if (mod && k === "z") { ev.preventDefault(); if (ev.shiftKey) redo(); else undo(); return; }
      if (mod && k === "y") { ev.preventDefault(); redo(); return; }
      if (!selected) return;
      if (ev.key === "Delete" || ev.key === "Backspace") { ev.preventDefault(); remove(selected.id); }
      else if (ev.key === "Escape") setSel(null);
      else if (ev.key === "Enter" && selected.type === "text") { ev.preventDefault(); startEditing(selected.id); }
      else if (mod && k === "d") { ev.preventDefault(); duplicate(selected); }
      else if (mod && k === "c") copied = selected;
      else if (ev.key.startsWith("Arrow")) {
        ev.preventDefault();
        const step = ev.shiftKey ? 10 : 1;
        const [dx, dy] = ev.key === "ArrowLeft" ? [-step, 0] : ev.key === "ArrowRight" ? [step, 0] : ev.key === "ArrowUp" ? [0, -step] : [0, step];
        update(selected.id, { x: selected.x + dx, y: selected.y + dy }, `nudge:${selected.id}`);
      }
    };
    paste.current = (ev) => {
      if (!mine(ev.target)) return;
      const file = [...(ev.clipboardData?.files ?? [])].find((f) => f.type.startsWith("image/"));
      if (file) { ev.preventDefault(); void uploadFile(file); return; }
      if (copied) { ev.preventDefault(); add({ ...copied, id: uid(), x: copied.x + 32, y: copied.y + 32 }); }
    };
  });
  useEffect(() => {
    const k = (e: KeyboardEvent) => keys.current(e);
    const p = (e: ClipboardEvent) => paste.current(e);
    window.addEventListener("keydown", k);
    window.addEventListener("paste", p);
    return () => { window.removeEventListener("keydown", k); window.removeEventListener("paste", p); };
  }, []);

  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  const editingEl = doc.elements.find((e) => e.id === editing && e.type === "text") as TextElement | undefined;

  return (
    <div ref={root} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-3">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-ink-200 bg-white p-1.5">
          <Tool label="Text box" onClick={() => add(newText(), true)}><Type className="h-4 w-4" /> Text</Tool>
          <Tool label="Picture" onClick={() => setPicker({ target: "new" })}><ImagePlus className="h-4 w-4" /> Picture</Tool>
          <div className="relative">
            <Tool label="Shape" onClick={() => setShapesOpen((o) => !o)} active={shapesOpen}><Shapes className="h-4 w-4" /> Shape</Tool>
            {shapesOpen && (
              <div className="absolute left-0 top-full z-20 mt-1 grid w-56 grid-cols-4 gap-1 rounded-xl border border-ink-200 bg-white p-2 shadow-lg">
                {SHAPES.map((s) => (
                  <button key={s.shape} type="button" title={s.label} aria-label={s.label}
                    className="grid h-11 place-items-center rounded-lg text-ink-700 hover:bg-ink-100"
                    onClick={() => { setShapesOpen(false); add(newShape(s.shape)); }}>{s.icon}</button>
                ))}
              </div>
            )}
          </div>
          <span className="mx-1 h-6 w-px bg-ink-200" />
          <Tool label="Undo (Ctrl+Z)" onClick={undo} disabled={!past.current.length}><Undo2 className="h-4 w-4" /></Tool>
          <Tool label="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!future.current.length}><Redo2 className="h-4 w-4" /></Tool>
          {selected && <>
            <span className="mx-1 h-6 w-px bg-ink-200" />
            <Tool label="Duplicate (Ctrl+D)" onClick={() => duplicate(selected)}><Copy className="h-4 w-4" /></Tool>
            <Tool label="Bring to front" onClick={() => layer(selected.id, "front")}><BringToFront className="h-4 w-4" /></Tool>
            <Tool label="Send to back" onClick={() => layer(selected.id, "back")}><SendToBack className="h-4 w-4" /></Tool>
            <Tool label="Delete (Del)" onClick={() => remove(selected.id)}><Trash2 className="h-4 w-4 text-rose-600" /></Tool>
          </>}
        </div>

        {/* The slide */}
        <div ref={stage} className="relative aspect-video w-full touch-none select-none rounded-xl shadow-[0_0_0_1px_rgb(0_0_0/0.08),0_8px_30px_-12px_rgb(0_0_0/0.25)]"
          onPointerDown={(ev) => { if (ev.target === ev.currentTarget || (ev.target as HTMLElement).dataset.stage) { setSel(null); setShapesOpen(false); } }}
          onDragOver={(ev) => { if (ev.dataTransfer.types.includes("Files")) ev.preventDefault(); }}
          onDrop={(ev) => { const f = ev.dataTransfer.files[0]; if (f) { ev.preventDefault(); void uploadFile(f); } }}>
          <div className="absolute inset-0 overflow-hidden rounded-xl"><CanvasView content={doc} editing hide={editing} /></div>
          <div data-stage="1" className="absolute inset-0" style={{ containerType: "inline-size" }}>
            {doc.elements.map((e) => e.id === editing ? null : (
              <div key={e.id} style={boxStyle({ ...e, opacity: 1 })} className="cursor-move"
                onPointerDown={(ev) => grab(ev, e)}
                onDoubleClick={() => { if (e.type === "text") startEditing(e.id); else if (e.type === "image") setPicker({ target: e.id }); }} />
            ))}
            {editingEl && (
              <div style={{ ...boxStyle(editingEl), ...textStyle(editingEl), display: "flex", flexDirection: "column", outline: "2px solid rgb(var(--brand-500))",
                justifyContent: editingEl.valign === "middle" ? "center" : editingEl.valign === "bottom" ? "flex-end" : "flex-start" }}>
                <EditableText e={editingEl} onInput={(text) => live(withEl(docRef.current, editingEl.id, { text }))} onDone={(text) => finishEditing(editingEl.id, text)} />
              </div>
            )}
            {selected && selected.id !== editing && (
              <div style={boxStyle({ ...selected, opacity: 1 })} className="cursor-move outline outline-2 outline-brand-500"
                onPointerDown={(ev) => grab(ev, selected)}
                onDoubleClick={() => { if (selected.type === "text") startEditing(selected.id); else if (selected.type === "image") setPicker({ target: selected.id }); }}>
                {HANDLES.filter(([, hy]) => !isFlat(selected) || hy === 0).map(([hx, hy]) => (
                  <span key={`${hx}${hy}`} aria-hidden style={{ left: pct(hx + 1, 2), top: pct(hy + 1, 2), cursor: CURSOR[`${hx}${hy}`] }}
                    className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-brand-600 bg-white"
                    onPointerDown={(ev) => { const p = pointAt(ev); begin(ev, { mode: "resize", start: selected, px: p.x, py: p.y, hx, hy, before: docRef.current, moved: false }); }} />
                ))}
                <span aria-hidden className="absolute left-1/2 top-0 h-6 w-px -translate-y-full bg-brand-500" />
                <span aria-hidden title="Rotate (Shift: 15° steps)"
                  className="absolute left-1/2 top-0 h-3.5 w-3.5 -translate-x-1/2 -translate-y-[2.4rem] cursor-grab rounded-full border-2 border-brand-600 bg-white"
                  onPointerDown={(ev) => begin(ev, { mode: "rotate", start: selected, before: docRef.current, moved: false })} />
              </div>
            )}
            {guides.x !== null && <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-rose-500" style={{ left: pct(guides.x, STAGE_W) }} />}
            {guides.y !== null && <span aria-hidden className="pointer-events-none absolute inset-x-0 h-px bg-rose-500" style={{ top: pct(guides.y, STAGE_H) }} />}
          </div>
        </div>
        <p className="text-xs text-ink-500">
          Double-click text to type. Drag to move, corners to resize, the round handle to rotate. Drop or paste a picture straight onto the slide.
          Arrow keys nudge, Ctrl+D duplicates, Ctrl+Z undoes. Hold Alt while dragging to turn off snapping.
        </p>
      </div>

      {/* Properties */}
      <aside className="space-y-5 rounded-xl border border-ink-200 bg-white p-4 text-sm">
        {selected ? <Properties key={selected.id} e={selected} update={update} alignTo={alignTo} layer={layer}
          choosePicture={() => setPicker({ target: selected.id })} /> : (
          <section className="space-y-3">
            <h3 className="font-semibold text-ink-900">Slide</h3>
            <Field label="Background colour"><ColorRow value={doc.background.color ?? "#ffffff"} onChange={(color) => setBg({ color }, "bg:color")} /></Field>
            <Field label="Background picture">
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPicker({ target: "background" })}>{doc.background.media_path ? "Replace" : "Choose"}</button>
                {doc.background.media_path && <>
                  <Select className="!w-auto" value={doc.background.fit} onChange={(e) => setBg({ fit: e.target.value as "cover" | "contain" })}>
                    <option value="cover">Fill the slide</option><option value="contain">Show it all</option>
                  </Select>
                  <button type="button" className="btn btn-ghost btn-sm text-rose-600" onClick={() => setBg({ media_path: undefined, alt: undefined })}>Remove</button>
                </>}
              </div>
            </Field>
            {doc.background.media_path && (
              <Field label="Describe the background picture" hint="Read aloud by screen readers.">
                <Input value={doc.background.alt ?? ""} onChange={(e) => setBg({ alt: e.target.value }, "bg:alt")} />
              </Field>
            )}
            <p className="text-xs text-ink-500">Click something on the slide to change it.</p>
          </section>
        )}
        <Field label="Speaker notes (only you see these)"><Textarea rows={4} value={notes ?? ""} onChange={(e) => onNotes(e.target.value)} /></Field>
      </aside>

      {picker && (
        <MediaPicker open onClose={() => setPicker(null)} kinds={["image"]} tenantId={lesson.tenant_id} userId={userId} lessonId={lesson.id}
          onPick={(m) => { const t = picker.target; setPicker(null); void placePicture(m.storage_path, m.alt_text ?? "", t); }} />
      )}
    </div>
  );
}

function EditableText({ e, onInput, onDone }: { e: TextElement; onInput: (t: string) => void; onDone: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    el.innerText = e.text;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    if (e.text !== "Type something") range.collapse(false);
    const s = window.getSelection();
    s?.removeAllRanges(); s?.addRange(range);
    // Only on opening: later renders must not reset what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const read = () => (ref.current?.innerText ?? "").replace(/\n$/, "");
  return (
    <div ref={ref} contentEditable="plaintext-only" suppressContentEditableWarning role="textbox" aria-multiline aria-label="Slide text"
      className="cursor-text outline-none" style={{ minHeight: "1.2em" }}
      onPointerDown={(ev) => ev.stopPropagation()}
      onInput={() => onInput(read())}
      onBlur={() => onDone(read())}
      onKeyDown={(ev) => { if (ev.key === "Escape") { ev.preventDefault(); ref.current?.blur(); } }} />
  );
}

function Tool({ label, onClick, disabled, active, children }: { label: string; onClick: () => void; disabled?: boolean; active?: boolean; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={typeof children === "object" && !Array.isArray(children) ? label : undefined} onClick={onClick} disabled={disabled}
      className={cn("inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-ink-800 transition hover:bg-ink-100 disabled:opacity-35 disabled:hover:bg-transparent",
        active && "bg-ink-100")}>
      {children}
    </button>
  );
}

function ColorRow({ value, onChange, none }: { value: string | undefined; onChange: (c: string | undefined) => void; none?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {none && (
        <button type="button" title={none} aria-label={none} aria-pressed={!value || value === "transparent"} onClick={() => onChange(undefined)}
          className={cn("relative h-6 w-6 overflow-hidden rounded-full border border-ink-300 bg-white", (!value || value === "transparent") && "ring-2 ring-brand-500 ring-offset-1")}>
          <span className="absolute left-1/2 top-[-2px] h-7 w-px rotate-45 bg-rose-500" />
        </button>
      )}
      {PALETTE.map((c) => (
        <button key={c} type="button" title={c} aria-label={`Colour ${c}`} aria-pressed={value?.toLowerCase() === c} onClick={() => onChange(c)}
          className={cn("h-6 w-6 rounded-full border border-ink-300", value?.toLowerCase() === c && "ring-2 ring-brand-500 ring-offset-1")} style={{ background: c }} />
      ))}
      <label className="relative h-6 w-6 cursor-pointer overflow-hidden rounded-full border border-ink-300" title="Any colour"
        style={{ background: "conic-gradient(#e11d48, #f59e0b, #c6f432, #16a34a, #0891b2, #2547d0, #7c3aed, #e11d48)" }}>
        <input type="color" aria-label="Any colour" className="absolute inset-0 cursor-pointer opacity-0"
          value={isColor(value) && /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

function Seg<T extends string>({ value, options, onChange }: { value: T; options: { v: T; label: string; icon: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-ink-200 p-0.5">
      {options.map((o) => (
        <button key={o.v} type="button" title={o.label} aria-label={o.label} aria-pressed={value === o.v} onClick={() => onChange(o.v)}
          className={cn("grid h-8 w-8 place-items-center rounded-md text-ink-700", value === o.v ? "bg-ink-900 text-white" : "hover:bg-ink-100")}>{o.icon}</button>
      ))}
    </div>
  );
}

function Flag({ on, label, onClick, children }: { on: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} aria-pressed={on} onClick={onClick}
      className={cn("grid h-8 w-8 place-items-center rounded-md border", on ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 text-ink-700 hover:bg-ink-100")}>{children}</button>
  );
}

function Num({ label, value, onChange, min, max }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-ink-500">{label}</span>
      <Input type="number" value={Math.round(value)} min={min} max={max} className="!h-8 !px-2 text-sm"
        onChange={(e) => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(n); }} />
    </label>
  );
}

function Properties({ e, update, alignTo, layer, choosePicture }: {
  e: CanvasElement;
  update: (id: string, patch: Partial<CanvasElement>, key?: string) => void;
  alignTo: (e: CanvasElement, where: "left" | "center" | "right" | "top" | "middle" | "bottom") => void;
  layer: (id: string, to: "front" | "back" | "up" | "down") => void;
  choosePicture: () => void;
}) {
  const set = (patch: Partial<CanvasElement>, key?: string) => update(e.id, patch, key);
  return (
    <>
      {e.type === "text" && <TextProps e={e} set={set} />}
      {e.type === "shape" && <ShapeProps e={e} set={set} />}
      {e.type === "image" && (
        <section className="space-y-3">
          <h3 className="font-semibold text-ink-900">Picture</h3>
          <button type="button" className="btn btn-secondary btn-sm" onClick={choosePicture}>{e.media_path || e.url ? "Replace picture" : "Choose picture"}</button>
          <Field label="Alt text" hint="Describe the picture for students using screen readers.">
            <Input value={e.alt} onChange={(ev) => set({ alt: ev.target.value }, `${e.id}:alt`)} />
          </Field>
          {!e.alt && (e.media_path || e.url) && <Alert tone="warn">Add alt text so every student can follow.</Alert>}
          <div className="flex flex-wrap items-center gap-3">
            <Select className="!w-auto" value={e.fit} onChange={(ev) => set({ fit: ev.target.value as "cover" | "contain" })}>
              <option value="cover">Fill the box (crop)</option><option value="contain">Show it all</option>
            </Select>
          </div>
          <label className="block">
            <span className="text-[11px] font-semibold text-ink-500">Rounded corners</span>
            <input type="range" min={0} max={200} value={e.radius ?? 0} className="w-full accent-ink-900" onChange={(ev) => set({ radius: Number(ev.target.value) }, `${e.id}:radius`)} />
          </label>
        </section>
      )}

      <section className="space-y-3 border-t border-ink-100 pt-4">
        <h3 className="font-semibold text-ink-900">Arrange</h3>
        <div className="flex flex-wrap gap-1">
          <Flag on={false} label="Align left" onClick={() => alignTo(e, "left")}><AlignStartVertical className="h-4 w-4" /></Flag>
          <Flag on={false} label="Centre across" onClick={() => alignTo(e, "center")}><AlignCenterVertical className="h-4 w-4" /></Flag>
          <Flag on={false} label="Align right" onClick={() => alignTo(e, "right")}><AlignEndVertical className="h-4 w-4" /></Flag>
          <Flag on={false} label="Align top" onClick={() => alignTo(e, "top")}><AlignStartHorizontal className="h-4 w-4" /></Flag>
          <Flag on={false} label="Centre down" onClick={() => alignTo(e, "middle")}><AlignCenterHorizontal className="h-4 w-4" /></Flag>
          <Flag on={false} label="Align bottom" onClick={() => alignTo(e, "bottom")}><AlignEndHorizontal className="h-4 w-4" /></Flag>
          <Flag on={false} label="Forward" onClick={() => layer(e.id, "up")}><ArrowUp className="h-4 w-4" /></Flag>
          <Flag on={false} label="Backward" onClick={() => layer(e.id, "down")}><ArrowDown className="h-4 w-4" /></Flag>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <Num label="X" value={e.x} onChange={(x) => set({ x }, `${e.id}:x`)} />
          <Num label="Y" value={e.y} onChange={(y) => set({ y }, `${e.id}:y`)} />
          <Num label="Width" value={e.w} min={4} onChange={(w) => set({ w: Math.max(w, 4) }, `${e.id}:w`)} />
          <Num label="Height" value={e.h} min={4} onChange={(h) => set({ h: Math.max(h, 4) }, `${e.id}:h`)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Num label="Rotation (°)" value={e.rotate ?? 0} min={-180} max={180} onChange={(rotate) => set({ rotate }, `${e.id}:rotate`)} />
          <label className="block">
            <span className="text-[11px] font-semibold text-ink-500">Opacity</span>
            <input type="range" min={10} max={100} value={Math.round((e.opacity ?? 1) * 100)} className="mt-2 w-full accent-ink-900"
              onChange={(ev) => set({ opacity: Number(ev.target.value) / 100 }, `${e.id}:opacity`)} />
          </label>
        </div>
      </section>
    </>
  );
}

function TextProps({ e, set }: { e: TextElement; set: (p: Partial<TextElement>, key?: string) => void }) {
  return (
    <section className="space-y-3">
      <h3 className="font-semibold text-ink-900">Text</h3>
      <div className="grid grid-cols-[1fr_88px] gap-2">
        <Select value={e.font} onChange={(ev) => set({ font: ev.target.value as TextElement["font"] })} aria-label="Font">
          {FONTS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </Select>
        <Select value={SIZES.includes(e.size) ? e.size : ""} aria-label="Text size" onChange={(ev) => ev.target.value && set({ size: Number(ev.target.value) })}>
          {!SIZES.includes(e.size) && <option value="">{Math.round(e.size)}</option>}
          {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <Flag on={!!e.bold} label="Bold" onClick={() => set({ bold: !e.bold })}><Bold className="h-4 w-4" /></Flag>
        <Flag on={!!e.italic} label="Italic" onClick={() => set({ italic: !e.italic })}><Italic className="h-4 w-4" /></Flag>
        <Flag on={!!e.underline} label="Underline" onClick={() => set({ underline: !e.underline })}><Underline className="h-4 w-4" /></Flag>
        <Flag on={!!e.list} label="Bullet points" onClick={() => set({ list: !e.list })}><List className="h-4 w-4" /></Flag>
        <span className="mx-1" />
        <Seg value={e.align} onChange={(align) => set({ align })} options={[
          { v: "left", label: "Left", icon: <AlignLeft className="h-4 w-4" /> },
          { v: "center", label: "Centre", icon: <AlignCenter className="h-4 w-4" /> },
          { v: "right", label: "Right", icon: <AlignRight className="h-4 w-4" /> }]} />
      </div>
      <Field label="Position in the box">
        <Select value={e.valign} onChange={(ev) => set({ valign: ev.target.value as TextElement["valign"] })}>
          <option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option>
        </Select>
      </Field>
      <Field label="Text colour"><ColorRow value={e.color} onChange={(color) => set({ color: color ?? "#111827" }, `${e.id}:color`)} /></Field>
      <Field label="Box colour"><ColorRow value={e.fill} none="No box colour" onChange={(fill) => set({ fill }, `${e.id}:fill`)} /></Field>
    </section>
  );
}

function ShapeProps({ e, set }: { e: ShapeElement; set: (p: Partial<ShapeElement>, key?: string) => void }) {
  const flat = e.shape === "line" || e.shape === "arrow";
  return (
    <section className="space-y-3">
      <h3 className="font-semibold text-ink-900">{flat ? "Line" : "Shape"}</h3>
      <div className="flex flex-wrap gap-1">
        {SHAPES.filter((s) => (s.shape === "line" || s.shape === "arrow") === flat).map((s) => (
          <Flag key={s.shape} on={e.shape === s.shape} label={s.label} onClick={() => set({ shape: s.shape })}>{s.icon}</Flag>
        ))}
      </div>
      <Field label={flat ? "Colour" : "Fill"}><ColorRow value={e.fill} none={flat ? undefined : "No fill"} onChange={(fill) => set({ fill: fill ?? "transparent" }, `${e.id}:fill`)} /></Field>
      {!flat && <Field label="Border"><ColorRow value={e.stroke} none="No border" onChange={(stroke) => set({ stroke: stroke ?? "transparent", strokeWidth: stroke && !e.strokeWidth ? 6 : e.strokeWidth }, `${e.id}:stroke`)} /></Field>}
      <label className="block">
        <span className="text-[11px] font-semibold text-ink-500">{flat ? "Thickness" : "Border width"}</span>
        <input type="range" min={flat ? 2 : 0} max={40} value={e.strokeWidth} className="w-full accent-ink-900"
          onChange={(ev) => set({ strokeWidth: Number(ev.target.value) }, `${e.id}:sw`)} />
      </label>
    </section>
  );
}
