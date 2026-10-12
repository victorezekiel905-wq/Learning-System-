"use client";
// Download a lesson as a PowerPoint file (opens in PowerPoint, Google Slides and Keynote).
// Designed slides keep their layout: text boxes, shapes and pictures land where they are
// on the 1600 x 900 grid, as editable PowerPoint objects; teacher notes become speaker
// notes. Older slide kinds are turned into designed slides first.
import { cleanCanvas, STAGE_W, toCanvas, type CanvasContent, type FontKey, type ShapeKind } from "@/slides/canvas";
import { signedUrl } from "./media";

export type ExportSlide = {
  kind: string; content: Record<string, unknown> | CanvasContent | null; notes?: string | null;
  activity?: { title: string; instructions?: string | null } | null;
};

const IN = 13.333 / STAGE_W;   // grid units to inches (PowerPoint's wide 16:9 slide)
const PT = 0.6;                // grid units to points (960 pt across the slide)
const FONT: Record<FontKey, string> = { sans: "Calibri", display: "Calibri", readable: "Verdana", serif: "Georgia", mono: "Consolas", hand: "Segoe Print" };

/** "#rrggbb" or "#rrggbbaa" (or 3/4-digit) to PowerPoint's colour and transparency. */
function colour(c: string | undefined, fallback = "FFFFFF"): { color: string; transparency: number } | null {
  if (!c || c === "transparent") return null;
  let h = c.replace("#", "");
  if (h.length === 3 || h.length === 4) h = h.split("").map((x) => x + x).join("");
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return { color: fallback, transparency: 0 };
  const alpha = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
  return { color: h.slice(0, 6).toUpperCase(), transparency: Math.round((1 - alpha) * 100) };
}

async function asDataUrl(src: string): Promise<string | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(typeof r.result === "string" ? r.result : null);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch { return null; }
}
async function picture(mediaPath?: string, url?: string) {
  const src = mediaPath ? await signedUrl(mediaPath) : url;
  return src ? asDataUrl(src) : null;
}

/** Any slide as a designed one, so it can be laid out the same way. */
function designed(s: ExportSlide): CanvasContent {
  const c = (s.content ?? {}) as Record<string, string | boolean | undefined>;
  if (s.kind === "canvas") return s.content as CanvasContent;
  if (s.kind === "title" || s.kind === "text" || s.kind === "image") return toCanvas(s.kind, c as Parameters<typeof toCanvas>[1]);
  const heading = s.kind === "activity" ? `Activity: ${s.activity?.title ?? "Activity"}` : String(c.heading ?? "");
  const body = s.kind === "activity" ? (s.activity?.instructions ?? "Answer on your device in SwiftCipher.")
    : [c.body, c.url].filter((x) => typeof x === "string" && x).join("\n");
  return toCanvas("text", { heading, body: String(body ?? "") });
}

const SHAPES: Record<ShapeKind, string> = { rect: "rect", round: "roundRect", ellipse: "ellipse", triangle: "triangle", diamond: "diamond", star: "star5", line: "line", arrow: "line" };

/** Builds the file and saves it to the device ("Downloads", or wherever the browser asks). */
export async function downloadPptx(title: string, slides: ExportSlide[]) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = title;
  pptx.company = "SwiftCipher";

  for (const s of slides) {
    const c = cleanCanvas(designed(s));
    const slide = pptx.addSlide();
    const bg = colour(c.background.color, "FFFFFF");
    slide.background = { color: bg?.color ?? "FFFFFF" };
    if (c.background.media_path) {
      const data = await picture(c.background.media_path);
      if (data) slide.addImage({ data, x: 0, y: 0, w: 13.333, h: 7.5, sizing: { type: c.background.fit === "contain" ? "contain" : "cover", w: 13.333, h: 7.5 }, altText: c.background.alt });
    }
    for (const e of c.elements) {
      const box = { x: e.x * IN, y: e.y * IN, w: e.w * IN, h: e.h * IN, rotate: e.rotate || undefined };
      if (e.type === "image") {
        const data = await picture(e.media_path, e.url);
        if (data) slide.addImage({ data, ...box, sizing: { type: e.fit === "contain" ? "contain" : "cover", w: box.w, h: box.h }, rounding: false, altText: e.alt });
      } else if (e.type === "shape") {
        const fill = colour(e.fill), line = colour(e.stroke);
        const flat = e.shape === "line" || e.shape === "arrow";
        slide.addShape(SHAPES[e.shape] as never, {
          ...box,
          fill: !flat && fill ? { color: fill.color, transparency: fill.transparency } : undefined,
          line: flat ? { color: fill?.color ?? "111827", width: Math.max(1, e.strokeWidth * PT), endArrowType: e.shape === "arrow" ? "triangle" : undefined }
            : line && e.strokeWidth ? { color: line.color, width: e.strokeWidth * PT } : { type: "none" },
          rectRadius: e.shape === "round" ? 0.15 : undefined
        });
      } else {
        const col = colour(e.color, "111827"), fill = colour(e.fill);
        const opts = {
          ...box, fontFace: FONT[e.font] ?? "Calibri", fontSize: Math.max(6, Math.round(e.size * PT)), color: col?.color ?? "111827",
          bold: !!e.bold, italic: !!e.italic, underline: e.underline ? { style: "sng" as const } : undefined,
          align: e.align, valign: e.valign, margin: 4, fit: "shrink" as const,
          fill: fill ? { color: fill.color, transparency: fill.transparency } : undefined,
          transparency: e.opacity && e.opacity < 1 ? Math.round((1 - e.opacity) * 100) : undefined
        };
        if (e.list) {
          const lines = e.text.split("\n").filter((l) => l.trim());
          slide.addText(lines.map((l) => ({ text: l, options: { bullet: true, breakLine: true, paraSpaceAfter: 6 } })), opts);
        } else slide.addText(e.text, opts);
      }
    }
    if (s.notes) slide.addNotes(s.notes);
  }
  const safe = title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "Lesson";
  await pptx.writeFile({ fileName: `${safe}.pptx` });
}
