"use client";
import type { ReactNode } from "react";
import { RichText } from "@/components/RichText";
import { embedUrl, isDirectVideo, useSignedUrl } from "@/lib/media";
import { safeHref } from "@/lib/utils";
import { Icon } from "@/components/Icon";
import type { Shape, SlideContent, SlideKind } from "@/lib/types";
import { BOARD_H, BOARD_W, StrokeLayer } from "./Whiteboard";

export type SlideData = {
  id: string;
  position: number;
  kind: SlideKind;
  content: SlideContent;
  activity?: { id: string; kind: string; title: string; instructions?: string | null } | null;
};

export function ShapesSvg({ shapes }: { shapes: Shape[] }) {
  return (
    <>
      {shapes.map((s) => {
        if (s.type === "rect") return <rect key={s.id} x={s.x} y={s.y} width={s.w} height={s.h} rx={8} fill={s.color} fillOpacity={0.85} />;
        if (s.type === "ellipse") return <ellipse key={s.id} cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2} fill={s.color} fillOpacity={0.85} />;
        if (s.type === "arrow") return (
          <g key={s.id} stroke={s.color} strokeWidth={6} fill={s.color}>
            <line x1={s.x} y1={s.y + s.h / 2} x2={s.x + s.w - 18} y2={s.y + s.h / 2} />
            <polygon points={`${s.x + s.w},${s.y + s.h / 2} ${s.x + s.w - 24},${s.y + s.h / 2 - 14} ${s.x + s.w - 24},${s.y + s.h / 2 + 14}`} />
          </g>
        );
        return <text key={s.id} x={s.x} y={s.y + s.h * 0.75} fontSize={s.h} fill={s.color} fontWeight={600}>{s.text}</text>;
      })}
    </>
  );
}

/**
 * Renders any slide kind. `activitySlot` lets live/student views put the
 * interactive activity where the slide sits; `overlay` hosts live annotation.
 */
export function SlideView({ slide, activitySlot, overlay, onVideoTime, videoRef }: {
  slide: SlideData;
  activitySlot?: ReactNode;
  overlay?: ReactNode;
  onVideoTime?: (t: number, el: HTMLVideoElement) => void;
  videoRef?: React.Ref<HTMLVideoElement>;
}) {
  const c = slide.content ?? {};
  const mediaUrl = useSignedUrl(c.media_path);
  const captionsUrl = useSignedUrl(c.captions_path);
  const src = mediaUrl ?? c.url;

  let inner: ReactNode;
  switch (slide.kind) {
    case "title":
      inner = (
        <div className="flex h-full flex-col items-start justify-end bg-ink-950 p-8 text-left text-white sm:p-14"><span aria-hidden className="mb-5 h-2 w-16 rounded-full bg-accent-500 sm:mb-7" />
          <h2 className="max-w-4xl text-3xl font-extrabold leading-[1.02] tracking-tightest text-white sm:text-6xl">{c.heading || "Untitled"}</h2>
          {c.body && <p className="mt-4 max-w-2xl text-lg text-ink-300 sm:text-xl">{c.body}</p>}
        </div>
      );
      break;
    case "text":
      inner = (
        <div className="h-full overflow-y-auto p-8 sm:p-12">
          {c.heading && <h2 className="mb-4 text-2xl font-bold text-ink-900 sm:text-3xl">{c.heading}</h2>}
          <RichText text={c.body} className="text-base text-ink-700 sm:text-lg" />
        </div>
      );
      break;
    case "image":
      inner = (
        <figure className="flex h-full flex-col items-center justify-center bg-ink-900 p-4">
          {src ? <img src={src} alt={c.alt ?? ""} className="max-h-full max-w-full object-contain" /> : <p className="text-ink-300">No image selected</p>}
          {c.caption && <figcaption className="mt-2 text-sm text-ink-200">{c.caption}</figcaption>}
        </figure>
      );
      break;
    case "video": {
      const direct = mediaUrl || isDirectVideo(c.url);
      inner = direct ? (
        <video ref={videoRef} controls className="h-full w-full bg-black" src={src ?? undefined} crossOrigin="anonymous"
          onTimeUpdate={(e) => onVideoTime?.(e.currentTarget.currentTime, e.currentTarget)}>
          {captionsUrl && <track kind="captions" src={captionsUrl} srcLang="en" label="Captions" default />}
        </video>
      ) : embedUrl(c.url) ? (
        <iframe src={embedUrl(c.url)!} title={c.heading || "Video"} className="h-full w-full" allow="encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
      ) : <div className="grid h-full place-items-center text-ink-500">No video set</div>;
      break;
    }
    case "audio":
      inner = (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
          {c.heading && <h2 className="text-2xl font-bold">{c.heading}</h2>}
          {src ? <audio controls src={src} className="w-full max-w-lg" /> : <p className="text-ink-500">No audio selected</p>}
          {c.body && <details className="w-full max-w-lg text-sm"><summary className="cursor-pointer font-medium">Transcript</summary><RichText text={c.body} className="mt-2" /></details>}
        </div>
      );
      break;
    case "embed": {
      const u = embedUrl(c.url);
      inner = u ? (
        <iframe src={u} title={c.heading || "Embedded content"} className="h-full w-full"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation" referrerPolicy="no-referrer" />
      ) : <div className="grid h-full place-items-center text-ink-500">Add an https:// link to embed</div>;
      break;
    }
    case "link":
      inner = (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
          {c.heading && <h2 className="text-2xl font-bold">{c.heading}</h2>}
          <RichText text={c.body} className="max-w-xl text-ink-600" />
          {safeHref(c.url) && <a href={safeHref(c.url)!} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-lg no-underline">{c.label || "Open link"}<Icon name="external" className="h-4 w-4" /></a>}
        </div>
      );
      break;
    case "attachment":
      inner = (
        <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
          <h2 className="text-2xl font-bold">{c.heading || "Attachment"}</h2>
          <RichText text={c.body} className="max-w-xl text-ink-600" />
          {src && <a href={src} target="_blank" rel="noopener noreferrer" className="btn btn-primary no-underline">Download {c.label ?? "file"}</a>}
        </div>
      );
      break;
    case "shapes":
    case "whiteboard":
      inner = (
        <svg viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} className="h-full w-full bg-white" role="img" aria-label={c.heading || "Diagram"}>
          {c.heading && <text x={30} y={50} fontSize={32} fontWeight={700} fill="#0f172a">{c.heading}</text>}
          <ShapesSvg shapes={c.shapes ?? []} />
          <StrokeLayer strokes={c.strokes ?? []} />
        </svg>
      );
      break;
    case "activity":
      inner = activitySlot ?? (
        <div className="flex h-full flex-col items-center justify-center gap-2 bg-brand-50 p-8 text-center">
          <p className="text-[13px] font-semibold text-ink-600">Activity</p>
          <h2 className="text-2xl font-bold text-ink-900">{slide.activity?.title ?? "Activity"}</h2>
          {slide.activity?.instructions && <p className="max-w-lg text-ink-600">{slide.activity.instructions}</p>}
        </div>
      );
      break;
    default:
      inner = null;
  }

  if (slide.kind === "activity" && activitySlot) {
    return <div className="w-full">{activitySlot}</div>;
  }
  return (
    <div className="slide-surface">
      {inner}
      {overlay && <div className="pointer-events-none absolute inset-0">{overlay}</div>}
    </div>
  );
}
