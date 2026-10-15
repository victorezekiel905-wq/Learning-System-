"use client";
import { useRef, useState, type ReactNode } from "react";
import { ImageDown } from "lucide-react";
import { Button, useToast } from "@/components/ui";
import type { LearnerSlide } from "./LessonStage";

// Slides a student can keep: not questions (that would hand out the test), not videos
// or embedded pages (the browser can't copy what another site draws).
const SAVABLE = new Set(["title", "text", "image", "canvas", "shapes", "whiteboard", "link", "attachment"]);

/**
 * The lesson slide with a "Save slide" button under it: saves exactly what the student
 * sees (teacher's drawings included) as a picture on their device, for revision.
 */
export function SavableSlide({ slide, title, children }: { slide: LearnerSlide; title: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const can = SAVABLE.has(slide.kind);

  async function save() {
    const node = box.current?.querySelector<HTMLElement>(".slide-surface") ?? box.current;
    if (!node) return;
    setBusy(true);
    try {
      const { toPng } = await import("html-to-image");
      const url = await toPng(node, { pixelRatio: Math.max(2, window.devicePixelRatio || 1), backgroundColor: "#ffffff" });
      const a = document.createElement("a");
      a.href = url;
      a.download = `${title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 60) || "Lesson"} - slide ${slide.position + 1}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      toast("Slide saved to your device.", "success");
    } catch {
      toast("Couldn't save this slide. Try again, or use your device's screenshot.", "error");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      <div ref={box}>{children}</div>
      {can && (
        <div className="flex justify-end">
          <Button size="sm" variant="ghost" loading={busy} onClick={() => void save()} title="Save this slide as a picture">
            <ImageDown className="h-4 w-4" aria-hidden /> Save slide
          </Button>
        </div>
      )}
    </div>
  );
}
