/**
 * Slide types (docs/LIVE_ENGINE.md §4): what each kind is called, which group it
 * is offered in when adding a slide, and how it is edited. The live session only
 * knows "content slide" vs "activity slide", so adding a type never touches it.
 */
import type { SlideKind } from "@/lib/types";

export type SlideType = {
  label: string;
  /** "design": laid out on the canvas; "media": a form; "activity": students answer; "older": still shown, no longer offered. */
  group: "design" | "media" | "activity" | "older";
  help?: string;
  editor: "canvas" | "form" | "activity";
};

export const SLIDE_TYPES: Record<SlideKind, SlideType> = {
  canvas: { label: "Designed slide", group: "design", editor: "canvas" },
  video: { label: "Video", group: "media", editor: "form", help: "YouTube, Vimeo or your own video. It pauses to ask questions." },
  embed: { label: "Web page or simulation", group: "media", editor: "form", help: "Any secure website, such as a PhET simulation or a 3D model." },
  audio: { label: "Audio", group: "media", editor: "form", help: "A recording students can play." },
  whiteboard: { label: "Whiteboard", group: "media", editor: "form", help: "A blank board to draw on during the lesson." },
  link: { label: "Link", group: "media", editor: "form", help: "A button that opens a website." },
  attachment: { label: "File", group: "media", editor: "form", help: "A worksheet or document to download." },
  activity: { label: "Activity", group: "activity", editor: "activity" },
  title: { label: "Title", group: "older", editor: "form" },
  text: { label: "Text", group: "older", editor: "form" },
  image: { label: "Picture", group: "older", editor: "form" },
  shapes: { label: "Diagram", group: "older", editor: "form" }
};

export const slideLabel = (k: SlideKind) => SLIDE_TYPES[k]?.label ?? k;
export const MEDIA_KINDS = (Object.keys(SLIDE_TYPES) as SlideKind[]).filter((k) => SLIDE_TYPES[k].group === "media");
