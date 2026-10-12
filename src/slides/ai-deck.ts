/**
 * "Create slides with AI": turns the outline the AI writes (layout, heading, points,
 * a photo idea, teacher notes) into designed slides on the 1600 x 900 grid, in one
 * of the lesson themes. All the design decisions live here, not in the AI:
 *  - the deck always opens with a title slide and (if long enough) ends with a recap;
 *  - text is trimmed and sized to fit its box, so nothing spills off a slide;
 *  - a slide that wanted a photo but got none falls back to a text layout;
 *  - every photo carries its photographer's credit (Unsplash's rule).
 * Relative imports only: the unit tests load this file directly.
 */
import type { CanvasContent, CanvasElement, ImageElement, ShapeElement, TextElement } from "./canvas";

export const DECK_LAYOUTS = ["title", "objectives", "points", "picture", "big_picture", "compare", "key_fact", "question", "summary"] as const;
export type DeckLayout = (typeof DECK_LAYOUTS)[number];

export type OutlineSlide = {
  layout: DeckLayout; heading: string; subheading?: string; points?: string[];
  left_heading?: string; left_points?: string[]; right_heading?: string; right_points?: string[];
  image_query?: string; notes?: string;
};
export type Outline = { title: string; slides: OutlineSlide[] };
export type Photo = { url: string; alt: string; credit: string; credit_url: string; download_location: string };
export type DeckSlide = { content: CanvasContent; notes: string; heading: string; photo?: Photo };

export type ThemeKey = "swift" | "ocean" | "sunrise";
type Theme = { label: string; dark: string; light: string; soft: string; accent: string; primary: string; text: string; muted: string; onDark: string; onDarkMuted: string };
export const THEMES: Record<ThemeKey, Theme> = {
  swift: { label: "SwiftCipher", dark: "#111827", light: "#ffffff", soft: "#f5f3ef", accent: "#c6f432", primary: "#2547d0", text: "#111827", muted: "#475569", onDark: "#ffffff", onDarkMuted: "#cbd5e1" },
  ocean: { label: "Ocean", dark: "#0c4a6e", light: "#f8fafc", soft: "#e0f2fe", accent: "#38bdf8", primary: "#0e7490", text: "#0f172a", muted: "#475569", onDark: "#ffffff", onDarkMuted: "#bae6fd" },
  sunrise: { label: "Sunrise", dark: "#7c2d12", light: "#fffbeb", soft: "#ffedd5", accent: "#fbbf24", primary: "#c2410c", text: "#1c1917", muted: "#57534e", onDark: "#ffffff", onDarkMuted: "#fed7aa" }
};

let n = 0;
const id = () => `ai${Date.now().toString(36)}${(n++).toString(36)}`;
const clip = (s: string | undefined, max: number) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
};
const list = (xs: string[] | undefined, count: number, each: number) =>
  (xs ?? []).map((x) => clip(x.replace(/^\s*[-*•\d.)]+\s*/, ""), each)).filter(Boolean).slice(0, count);

/**
 * The largest font size (from `max` down to `min`) at which `text` fits a w x h box,
 * estimating an average character at 0.52 of the size and lines at 1.3.
 */
export function fitSize(text: string, w: number, h: number, max: number, min: number): number {
  const paras = text.split("\n");
  for (let size = max; size > min; size -= 2) {
    const perLine = Math.max(1, Math.floor(w / (size * 0.52)));
    const lines = paras.reduce((sum, p) => sum + Math.max(1, Math.ceil(p.length / perLine)), 0);
    if (lines * size * 1.3 <= h) return size;
  }
  return min;
}

const text = (over: Partial<TextElement> & Pick<TextElement, "x" | "y" | "w" | "h" | "text">): TextElement => ({
  id: id(), type: "text", size: 40, color: "#111827", font: "sans", align: "left", valign: "top", ...over
});
const shape = (over: Partial<ShapeElement> & Pick<ShapeElement, "x" | "y" | "w" | "h">): ShapeElement => ({
  id: id(), type: "shape", shape: "rect", fill: "#2547d0", stroke: "transparent", strokeWidth: 0, ...over
});
const image = (p: Photo, over: Pick<ImageElement, "x" | "y" | "w" | "h"> & Partial<ImageElement>): ImageElement => ({
  id: id(), type: "image", url: p.url, alt: p.alt, fit: "cover", ...over
});
/** "Photo: Name / Unsplash", small, in a corner of the slide. */
const credit = (p: Photo, onDark: boolean): TextElement => text({
  x: 1040, y: 852, w: 540, h: 36, text: `Photo: ${clip(p.credit, 40)} / Unsplash`, size: 18, align: "right", valign: "middle",
  color: onDark ? "#e2e8f0" : "#64748b"
});
const heading = (t: Theme, s: string, over: Partial<TextElement> = {}) => {
  const h = clip(s, 90);
  return text({ x: 100, y: 64, w: 1400, h: 140, text: h, size: fitSize(h, 1400, 140, 64, 40), bold: true, font: "display", color: t.text, valign: "middle", ...over });
};
const bullets = (t: Theme, points: string[], box: { x: number; y: number; w: number; h: number }, max = 52, color = t.muted) => {
  const body = points.join("\n");
  return text({ ...box, text: body || " ", size: fitSize(body, box.w - 40, box.h, max, 22), color, list: true });
};

/** One outline slide in a theme. A slide that wanted a photo but has none gets a text layout. */
export function designSlide(s: OutlineSlide, t: Theme, photo?: Photo): CanvasContent {
  const layout: DeckLayout = (s.layout === "picture" || s.layout === "big_picture") && !photo ? "points" : s.layout;
  const els: CanvasElement[] = [];
  let bg = t.light;
  const points = list(s.points, layout === "picture" ? 4 : 5, 110);

  switch (layout) {
    case "title": {
      bg = t.dark;
      const title = clip(s.heading, 80), sub = clip(s.subheading, 120);
      if (photo) els.push(image(photo, { x: 0, y: 0, w: 1600, h: 900 }), shape({ x: 0, y: 0, w: 1600, h: 900, fill: `${t.dark}d9` }));
      els.push(shape({ x: 120, y: 290, w: 120, h: 16, shape: "round", fill: t.accent }),
        text({ x: 120, y: 330, w: 1360, h: 260, text: title, size: fitSize(title, 1360, 260, 112, 64), bold: true, font: "display", color: t.onDark }));
      if (sub) els.push(text({ x: 120, y: 610, w: 1360, h: 110, text: sub, size: fitSize(sub, 1360, 110, 40, 28), color: t.onDarkMuted }));
      if (photo) els.push(credit(photo, true));
      break;
    }
    case "objectives": {
      els.push(heading(t, s.heading || "In this lesson we will"));
      const goals = list(s.points, 4, 100);
      goals.forEach((g, i) => {
        const y = 250 + i * 150;
        els.push(shape({ x: 100, y, w: 96, h: 96, shape: "ellipse", fill: t.primary }),
          text({ x: 100, y, w: 96, h: 96, text: String(i + 1), size: 44, bold: true, color: "#ffffff", align: "center", valign: "middle", font: "display" }),
          text({ x: 230, y, w: 1270, h: 110, text: g, size: fitSize(g, 1270, 110, 48, 28), color: t.text, valign: "middle" }));
      });
      break;
    }
    case "picture": {
      els.push(heading(t, s.heading), image(photo!, { x: 100, y: 230, w: 720, h: 600, radius: 28 }),
        bullets(t, points, { x: 880, y: 240, w: 620, h: 580 }, 46), credit(photo!, false));
      break;
    }
    case "big_picture": {
      bg = t.dark;
      const cap = clip(s.heading, 90);
      els.push(image(photo!, { x: 0, y: 0, w: 1600, h: 900 }),
        text({ x: 80, y: 690, w: 1440, h: 140, text: cap, size: fitSize(cap, 1400, 140, 52, 30), bold: true, color: "#ffffff", fill: `${t.dark}cc`, valign: "middle", font: "display" }),
        credit(photo!, true));
      break;
    }
    case "compare": {
      els.push(heading(t, s.heading));
      const col = (x: number, h: string | undefined, ps: string[] | undefined) => {
        const title = clip(h, 40);
        els.push(shape({ x, y: 230, w: 680, h: 600, shape: "round", fill: t.soft }),
          text({ x: x + 40, y: 260, w: 600, h: 80, text: title || " ", size: fitSize(title, 600, 80, 44, 28), bold: true, color: t.primary, font: "display", valign: "middle" }),
          bullets(t, list(ps, 4, 90), { x: x + 40, y: 360, w: 600, h: 440 }, 44, t.text));
      };
      col(100, s.left_heading, s.left_points);
      col(820, s.right_heading, s.right_points);
      break;
    }
    case "key_fact": {
      bg = t.primary;
      const fact = clip(s.heading, 120), more = clip(s.subheading, 160);
      els.push(text({ x: 160, y: 170, w: 1280, h: 400, text: fact, size: fitSize(fact, 1280, 400, 104, 52), bold: true, font: "display", color: "#ffffff", align: "center", valign: "middle" }));
      if (more) els.push(text({ x: 200, y: 600, w: 1200, h: 150, text: more, size: fitSize(more, 1200, 150, 40, 26), color: "#ffffff", align: "center", valign: "top", opacity: 0.9 }));
      break;
    }
    case "question": {
      bg = t.dark;
      const q = clip(s.heading, 140);
      els.push(text({ x: 160, y: 140, w: 1280, h: 80, text: "THINK, PAIR, SHARE", size: 30, bold: true, color: t.accent, align: "center", valign: "middle" }),
        text({ x: 160, y: 240, w: 1280, h: 460, text: q, size: fitSize(q, 1280, 460, 96, 48), bold: true, font: "display", color: t.onDark, align: "center", valign: "middle" }));
      if (s.subheading) els.push(text({ x: 200, y: 720, w: 1200, h: 90, text: clip(s.subheading, 120), size: 32, color: t.onDarkMuted, align: "center", valign: "middle" }));
      break;
    }
    case "summary": {
      bg = t.soft;
      els.push(heading(t, s.heading || "Remember"), shape({ x: 100, y: 200, w: 120, h: 12, shape: "round", fill: t.primary }),
        bullets(t, points, { x: 100, y: 250, w: 1400, h: 580 }, 54, t.text));
      break;
    }
    default: {
      els.push(heading(t, s.heading), bullets(t, points, { x: 100, y: 240, w: 1400, h: 600 }));
    }
  }
  return { background: { color: bg }, elements: els };
}

/** The outline, tidied: a title slide first, a recap last (when long enough), and no more than `max` slides. */
export function tidyOutline(o: Outline, max: number): Outline {
  const slides = o.slides.filter((s) => s && DECK_LAYOUTS.includes(s.layout) && (s.heading || s.points?.length)).slice(0, max);
  if (!slides.length || slides[0]!.layout !== "title") slides.unshift({ layout: "title", heading: o.title || "Lesson" });
  if (slides.length > max) slides.length = max;
  if (max >= 5 && slides[slides.length - 1]!.layout !== "summary" && slides.length < max) {
    const recap = slides.flatMap((s) => (s.layout === "points" || s.layout === "picture") ? [s.heading] : []).slice(0, 4);
    if (recap.length >= 2) slides.push({ layout: "summary", heading: "Remember", points: recap, notes: "Go over the main ideas once more, and ask a few quick questions." });
  }
  return { title: clip(o.title, 120) || clip(slides[0]!.heading, 120) || "Lesson", slides };
}

/** The whole deck: designed slides with their teacher notes (and photo credits in the notes too). */
export function buildDeck(o: Outline, photos: (Photo | undefined)[], theme: ThemeKey): DeckSlide[] {
  const t = THEMES[theme] ?? THEMES.swift;
  return o.slides.map((s, i) => {
    const photo = photos[i];
    const notes = [clip(s.notes, 1500), photo ? `Photo by ${photo.credit} on Unsplash: ${photo.credit_url}` : ""].filter(Boolean).join("\n\n");
    return { content: designSlide(s, t, photo), notes, heading: clip(s.heading, 120), photo };
  });
}
