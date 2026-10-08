"use client";
import type { CSSProperties, ReactNode } from "react";
import { useSignedUrl } from "@/lib/media";
import { cleanCanvas, fontCss, STAGE_H, STAGE_W, type CanvasContent, type CanvasElement, type ImageElement, type ShapeElement, type TextElement } from "@/slides/canvas";

/*
 * Draws a designed slide. Everything is sized in container units of the slide
 * (1 grid unit = 1/16 cqw), so the slide scales as one picture: the projector,
 * a phone and a thumbnail all show the same layout.
 */

const u = (n: number) => `${n / 16}cqw`;
/** Where an element sits, as percentages of the slide. */
export function boxStyle(e: { x: number; y: number; w: number; h: number; rotate?: number; opacity?: number }): CSSProperties {
  return {
    position: "absolute", left: `${(e.x / STAGE_W) * 100}%`, top: `${(e.y / STAGE_H) * 100}%`,
    width: `${(e.w / STAGE_W) * 100}%`, height: `${(e.h / STAGE_H) * 100}%`,
    transform: e.rotate ? `rotate(${e.rotate}deg)` : undefined, opacity: e.opacity ?? 1
  };
}

export function TextBody({ e }: { e: TextElement }) {
  const lines = e.text.split("\n");
  return e.list ? (
    <>{lines.map((l, i) => (
      <div key={i} style={{ display: "grid", gridTemplateColumns: "1em 1fr", columnGap: "0.35em" }}>
        <span aria-hidden>{l.trim() ? "•" : ""}</span><span>{l || " "}</span>
      </div>
    ))}</>
  ) : <>{e.text || " "}</>;
}

export function textStyle(e: TextElement): CSSProperties {
  return {
    fontFamily: fontCss(e.font), fontSize: u(e.size), lineHeight: 1.2, color: e.color,
    fontWeight: e.bold ? 700 : 400, fontStyle: e.italic ? "italic" : "normal", textDecoration: e.underline ? "underline" : "none",
    textAlign: e.align, whiteSpace: "pre-wrap", overflowWrap: "break-word", padding: `${u(12)} ${u(16)}`,
    background: e.fill, borderRadius: e.fill ? u(16) : undefined
  };
}

function TextView({ e }: { e: TextElement }) {
  return (
    <div style={{ ...boxStyle(e), ...textStyle(e), display: "flex", flexDirection: "column",
      justifyContent: e.valign === "middle" ? "center" : e.valign === "bottom" ? "flex-end" : "flex-start" }}>
      <div><TextBody e={e} /></div>
    </div>
  );
}

function ImageView({ e, editing }: { e: ImageElement; editing?: boolean }) {
  const signed = useSignedUrl(e.media_path);
  const src = signed ?? e.url;
  if (!src) {
    return editing ? (
      <div style={{ ...boxStyle(e), borderRadius: u(e.radius ?? 0), fontSize: u(28) }}
        className="flex items-center justify-center border-2 border-dashed border-ink-300 bg-ink-100 text-ink-500">
        {e.media_path ? "Loading…" : "Picture: choose one on the right"}
      </div>
    ) : null;
  }
  return (
    <img src={src} alt={e.alt} draggable={false}
      style={{ ...boxStyle(e), objectFit: e.fit, borderRadius: u(e.radius ?? 0), userSelect: "none" }} />
  );
}

function starPoints(w: number, h: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.4 : 1;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${w / 2 + (r * w * Math.cos(a)) / 2},${h / 2 + (r * h * Math.sin(a)) / 2 + h * 0.03}`);
  }
  return pts.join(" ");
}

export function ShapeSvg({ e }: { e: ShapeElement }) {
  const { w, h } = e;
  const sw = e.strokeWidth;
  const paint = { fill: e.fill, stroke: e.stroke, strokeWidth: sw, strokeLinejoin: "round" as const };
  let shape: ReactNode;
  switch (e.shape) {
    case "line":
    case "arrow": {
      const head = Math.min(Math.max(sw * 3.2, 22), w / 2);
      const end = e.shape === "arrow" ? w - head * 0.9 : w - sw / 2;
      shape = (
        <>
          <line x1={sw / 2} y1={h / 2} x2={end} y2={h / 2} stroke={e.fill} strokeWidth={Math.max(sw, 1)} strokeLinecap="round" />
          {e.shape === "arrow" && <polygon points={`${w},${h / 2} ${w - head},${h / 2 - head * 0.6} ${w - head},${h / 2 + head * 0.6}`} fill={e.fill} />}
        </>
      );
      break;
    }
    case "ellipse": shape = <ellipse cx={w / 2} cy={h / 2} rx={Math.max(w / 2 - sw / 2, 1)} ry={Math.max(h / 2 - sw / 2, 1)} {...paint} />; break;
    case "triangle": shape = <polygon points={`${w / 2},${sw} ${w - sw},${h - sw / 2} ${sw},${h - sw / 2}`} {...paint} />; break;
    case "diamond": shape = <polygon points={`${w / 2},${sw / 2} ${w - sw / 2},${h / 2} ${w / 2},${h - sw / 2} ${sw / 2},${h / 2}`} {...paint} />; break;
    case "star": shape = <polygon points={starPoints(w, h)} {...paint} />; break;
    default: {
      const r = e.shape === "round" ? Math.min(Math.min(w, h) / 2, 32) : 0;
      shape = <rect x={sw / 2} y={sw / 2} width={Math.max(w - sw, 1)} height={Math.max(h - sw, 1)} rx={r} {...paint} />;
    }
  }
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" overflow="visible" aria-hidden>{shape}</svg>;
}

export function ElementView({ e, editing }: { e: CanvasElement; editing?: boolean }) {
  if (e.type === "text") return <TextView e={e} />;
  if (e.type === "image") return <ImageView e={e} editing={editing} />;
  return <div style={boxStyle(e)}><ShapeSvg e={e} /></div>;
}

function Background({ bg }: { bg: ReturnType<typeof cleanCanvas>["background"] }) {
  const src = useSignedUrl(bg.media_path);
  return src ? <img src={src} alt={bg.alt ?? ""} draggable={false} className="absolute inset-0 h-full w-full select-none" style={{ objectFit: bg.fit }} /> : null;
}

/**
 * Fills its positioned 16:9 parent (e.g. `.slide-surface`). `hide` leaves out one
 * element (the editor draws the one being typed in itself); `children` go on top.
 */
export function CanvasView({ content, editing, hide, children }: { content: CanvasContent; editing?: boolean; hide?: string | null; children?: ReactNode }) {
  const c = cleanCanvas(content);
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ containerType: "inline-size", background: c.background.color }}>
      <Background bg={c.background} />
      {c.elements.map((e) => (e.id === hide ? null : <ElementView key={e.id} e={e} editing={editing} />))}
      {children}
    </div>
  );
}

/** A designed slide on its own, e.g. a thumbnail. */
export function CanvasFrame({ content, className }: { content: CanvasContent; className?: string }) {
  return <div className={`relative aspect-video w-full overflow-hidden ${className ?? ""}`}><CanvasView content={content} /></div>;
}
