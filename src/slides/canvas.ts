/**
 * Designed ("canvas") slides: a 16:9 slide laid out freely with text boxes,
 * pictures and shapes. Positions use a fixed 1600 x 900 grid, so a slide looks
 * the same on a phone, a laptop and the projector.
 *
 * Content is stored as-is in lesson_slides.content and drawn by anyone in the
 * lesson, so everything is passed through `cleanCanvas` before it is drawn:
 * colours must be hex, links https, numbers in range.
 */
import { uid } from "@/lib/utils";

export const STAGE_W = 1600;
export const STAGE_H = 900;
export const MAX_ELEMENTS = 150;

export type FontKey = "sans" | "display" | "readable" | "serif" | "mono" | "hand";
export type ShapeKind = "rect" | "round" | "ellipse" | "triangle" | "diamond" | "star" | "line" | "arrow";

type Box = { id: string; x: number; y: number; w: number; h: number; rotate?: number; opacity?: number };
export type TextElement = Box & {
  type: "text"; text: string; size: number; color: string; font: FontKey;
  bold?: boolean; italic?: boolean; underline?: boolean; list?: boolean;
  align: "left" | "center" | "right"; valign: "top" | "middle" | "bottom"; fill?: string;
};
export type ImageElement = Box & { type: "image"; media_path?: string; url?: string; alt: string; fit: "cover" | "contain"; radius?: number };
export type ShapeElement = Box & { type: "shape"; shape: ShapeKind; fill: string; stroke: string; strokeWidth: number };
export type CanvasElement = TextElement | ImageElement | ShapeElement;
export type CanvasBackground = { color?: string; media_path?: string; alt?: string; fit?: "cover" | "contain" };
export type CanvasContent = { background?: CanvasBackground; elements?: CanvasElement[]; heading?: string };

export const FONTS: { key: FontKey; label: string; css: string }[] = [
  { key: "sans", label: "Inter", css: "var(--font-inter), Inter, ui-sans-serif, system-ui, sans-serif" },
  { key: "display", label: "Jakarta (headings)", css: "var(--font-jakarta), 'Plus Jakarta Sans', var(--font-inter), sans-serif" },
  { key: "readable", label: "Easy to read", css: "var(--font-readable), var(--font-inter), sans-serif" },
  { key: "serif", label: "Serif", css: "Georgia, 'Times New Roman', serif" },
  { key: "mono", label: "Code", css: "var(--font-mono), ui-monospace, monospace" },
  { key: "hand", label: "Handwriting", css: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive" }
];
export const fontCss = (k: FontKey | undefined) => (FONTS.find((f) => f.key === k) ?? FONTS[0]!).css;

/** Swatches offered everywhere; any hex colour is allowed through the colour picker. */
export const PALETTE = ["#111827", "#475569", "#94a3b8", "#ffffff", "#f5f3ef", "#2547d0", "#0891b2", "#16a34a",
  "#c6f432", "#f59e0b", "#ea580c", "#e11d48", "#db2777", "#7c3aed"];
export const SIZES = [16, 20, 24, 28, 32, 40, 48, 56, 64, 72, 88, 104, 128, 160];

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
export const isColor = (c: unknown): c is string => typeof c === "string" && (HEX.test(c) || c === "transparent");
const color = (c: unknown, fallback: string) => (isColor(c) ? c : fallback);
const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const https = (v: unknown) => (typeof v === "string" && /^https:\/\/[^\s"'<>]+$/i.test(v) ? v : undefined);

/** Returns a slide that is safe to draw, whatever is stored. */
export function cleanCanvas(c: CanvasContent | null | undefined): Required<Pick<CanvasContent, "background" | "elements">> {
  const bg = (c?.background ?? {}) as Record<string, unknown>;
  const elements: CanvasElement[] = [];
  for (const raw of (Array.isArray(c?.elements) ? c!.elements : []).slice(0, MAX_ELEMENTS)) {
    if (!raw || typeof raw !== "object") continue;
    const e = raw as unknown as Record<string, unknown>;
    const box: Box = {
      id: str(e.id, 40) || uid(),
      x: num(e.x, -STAGE_W, STAGE_W * 2, 0), y: num(e.y, -STAGE_H, STAGE_H * 2, 0),
      w: num(e.w, 4, STAGE_W * 3, 200), h: num(e.h, 4, STAGE_H * 3, 100),
      rotate: num(e.rotate, -360, 360, 0), opacity: num(e.opacity, 0.05, 1, 1)
    };
    if (e.type === "text") {
      elements.push({ ...box, type: "text", text: str(e.text, 5000), size: num(e.size, 8, 400, 40), color: color(e.color, "#111827"),
        font: pick(e.font, FONTS.map((f) => f.key), "sans"), bold: !!e.bold, italic: !!e.italic, underline: !!e.underline, list: !!e.list,
        align: pick(e.align, ["left", "center", "right"] as const, "left"), valign: pick(e.valign, ["top", "middle", "bottom"] as const, "top"),
        fill: isColor(e.fill) ? e.fill : undefined });
    } else if (e.type === "image") {
      elements.push({ ...box, type: "image", media_path: str(e.media_path, 400) || undefined, url: https(e.url), alt: str(e.alt, 300),
        fit: pick(e.fit, ["cover", "contain"] as const, "cover"), radius: num(e.radius, 0, 450, 0) });
    } else if (e.type === "shape") {
      elements.push({ ...box, type: "shape", shape: pick(e.shape, ["rect", "round", "ellipse", "triangle", "diamond", "star", "line", "arrow"] as const, "rect"),
        fill: color(e.fill, "#2547d0"), stroke: color(e.stroke, "transparent"), strokeWidth: num(e.strokeWidth, 0, 60, 0) });
    }
  }
  return {
    background: { color: color(bg.color, "#ffffff"), media_path: str(bg.media_path, 400) || undefined, alt: str(bg.alt, 300) || undefined,
                  fit: pick(bg.fit, ["cover", "contain"] as const, "cover") },
    elements
  };
}

/** The first line of the first text box: used as the slide's name in lists and reports. */
export function canvasHeading(elements: CanvasElement[] | undefined): string {
  const t = (elements ?? []).find((e): e is TextElement => e.type === "text" && !!e.text.trim());
  return t ? t.text.trim().split("\n")[0]!.slice(0, 120) : "";
}

// ---------------------------------------------------------------------------
// New elements and ready-made layouts
// ---------------------------------------------------------------------------

export function newText(over: Partial<TextElement> = {}): TextElement {
  return { id: uid(), type: "text", x: 400, y: 380, w: 800, h: 140, text: "Type something", size: 48, color: "#111827",
           font: "sans", align: "left", valign: "top", ...over };
}
export function newShape(shape: ShapeKind, over: Partial<ShapeElement> = {}): ShapeElement {
  const flat = shape === "line" || shape === "arrow";
  return { id: uid(), type: "shape", shape, x: 600, y: flat ? 420 : 300, w: flat ? 400 : 400, h: flat ? 60 : 300,
           fill: flat ? "#111827" : "#2547d0", stroke: "transparent", strokeWidth: flat ? 8 : 0, ...over };
}
export function newImage(over: Partial<ImageElement> = {}): ImageElement {
  return { id: uid(), type: "image", x: 500, y: 225, w: 600, h: 450, alt: "", fit: "cover", ...over };
}

const heading = (text: string, over: Partial<TextElement> = {}) =>
  newText({ x: 100, y: 64, w: 1400, h: 130, text, size: 64, bold: true, font: "display", valign: "middle", ...over });
const body = (over: Partial<TextElement> = {}) =>
  newText({ x: 100, y: 230, w: 1400, h: 600, text: "First point\nSecond point\nThird point", size: 36, color: "#334155", list: true, ...over });

export const LAYOUTS: { key: string; label: string; help: string; make: () => CanvasContent }[] = [
  { key: "title", label: "Title", help: "A big heading to open the lesson or a section.", make: () => ({
    background: { color: "#111827" },
    elements: [
      newShape("round", { x: 120, y: 300, w: 120, h: 16, fill: "#c6f432" }),
      newText({ x: 120, y: 340, w: 1360, h: 240, text: "Lesson title", size: 112, bold: true, font: "display", color: "#ffffff", valign: "top" }),
      newText({ x: 120, y: 600, w: 1360, h: 100, text: "Subtitle or your name", size: 40, color: "#cbd5e1" })
    ] }) },
  { key: "title_body", label: "Heading and points", help: "A heading with bullet points.", make: () => ({
    background: { color: "#ffffff" }, elements: [heading("Heading"), body()] }) },
  { key: "two_columns", label: "Two columns", help: "Compare two ideas side by side.", make: () => ({
    background: { color: "#ffffff" }, elements: [heading("Compare"),
      newShape("round", { x: 100, y: 230, w: 680, h: 600, fill: "#f5f3ef" }),
      newShape("round", { x: 820, y: 230, w: 680, h: 600, fill: "#f5f3ef" }),
      body({ x: 140, y: 260, w: 600, h: 540, text: "Left idea\nA detail", size: 34 }),
      body({ x: 860, y: 260, w: 600, h: 540, text: "Right idea\nA detail", size: 34 })] }) },
  { key: "picture_text", label: "Picture and text", help: "A picture beside your explanation.", make: () => ({
    background: { color: "#ffffff" }, elements: [heading("Heading"),
      newImage({ x: 100, y: 230, w: 700, h: 600, radius: 24 }),
      body({ x: 860, y: 230, w: 640, h: 600, size: 34, text: "Explain the picture\nPoint out a detail" })] }) },
  { key: "big_picture", label: "Big picture", help: "A picture across the whole slide with a caption.", make: () => ({
    background: { color: "#111827" }, elements: [
      newImage({ x: 0, y: 0, w: 1600, h: 900 }),
      newText({ x: 80, y: 700, w: 1440, h: 130, text: "Caption", size: 44, bold: true, color: "#ffffff", fill: "#111827cc", valign: "middle" })] }) },
  { key: "question", label: "Big question", help: "One question for the class to think about.", make: () => ({
    background: { color: "#2547d0" }, elements: [
      newText({ x: 160, y: 220, w: 1280, h: 460, text: "What would happen if…?", size: 96, bold: true, font: "display", color: "#ffffff",
                align: "center", valign: "middle" })] }) },
  { key: "blank", label: "Blank", help: "An empty slide to design yourself.", make: () => ({ background: { color: "#ffffff" }, elements: [] }) }
];

/** Turns a simple slide into a designed one, keeping what it shows. */
export function toCanvas(kind: string, c: { heading?: string; body?: string; media_path?: string; url?: string; alt?: string; caption?: string; full?: boolean }): CanvasContent {
  const plain = (s?: string) => (s ?? "").replace(/^\s*[-*]\s+/gm, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1")
    .replace(/\[(.+?)\]\((.+?)\)/g, "$1");
  if (kind === "title") {
    const l = LAYOUTS[0]!.make();
    const [bar, title, sub] = l.elements as [ShapeElement, TextElement, TextElement];
    return { ...l, elements: [bar, { ...title, text: c.heading || "Lesson title" }, ...(c.body ? [{ ...sub, text: c.body }] : [])] };
  }
  if (kind === "text") {
    const list = /^\s*[-*]\s+/m.test(c.body ?? "");
    return { background: { color: "#ffffff" }, elements: [
      ...(c.heading ? [heading(c.heading)] : []),
      body({ text: plain(c.body) || " ", list, y: c.heading ? 230 : 100, h: c.heading ? 600 : 700 })] };
  }
  if (kind === "image") {
    // An imported page becomes the background, so text and shapes can be added on top of it.
    if (c.media_path && (c.full || !c.caption)) {
      return { background: { color: "#111827", media_path: c.media_path, alt: c.alt, fit: "contain" }, elements: [] };
    }
    return { background: { color: "#111827" }, elements: [
      newImage({ x: 0, y: 0, w: 1600, h: c.caption ? 760 : 900, media_path: c.media_path, url: c.url, alt: c.alt ?? "", fit: "contain" }),
      ...(c.caption ? [newText({ x: 80, y: 770, w: 1440, h: 110, text: c.caption, size: 36, color: "#ffffff", align: "center", valign: "middle" })] : [])] };
  }
  return { background: { color: "#ffffff" }, elements: c.heading ? [heading(c.heading)] : [] };
}

export const CONVERTIBLE = ["title", "text", "image"];
