"use client";
import { useState } from "react";
import { LessonStage, type LearnerSlide } from "@/components/student/LessonStage";
import { Alert, Button, PageHeader } from "@/components/ui";
import { useLoader } from "@/lib/hooks";
import { rpc } from "@/lib/rpc";

type Shared = { lesson: { title: string; description: string | null }; slides: LearnerSlide[]; share: { mode: string; expires_at: string } };

/** Student-paced lesson opened from a secure share link (§3.1). */
export function SharedLesson({ code, tenantId, userId }: { code: string; tenantId: string; userId: string }) {
  const data = useLoader(() => rpc<Shared>("open_lesson_share", { p_code: code }), [code]);
  const [i, setI] = useState(0);
  if (data.error) return <div className="page max-w-xl"><Alert tone="warn">{data.error}</Alert></div>;
  if (!data.data) return <div className="page text-sm text-ink-500">Opening lesson…</div>;
  const slides = data.data.slides;
  const slide = slides[i];
  const viewOnly = data.data.share.mode === "front_of_class";
  return (
    <div className="page max-w-5xl space-y-4">
      <PageHeader title={data.data.lesson.title} subtitle={data.data.lesson.description ?? undefined} />
      {slide && (viewOnly && slide.kind === "activity" ? <Alert>This lesson is shared view-only; activities are answered in class.</Alert>
        : <LessonStage slide={slide} shareCode={code} tenantId={tenantId} userId={userId} />)}
      <div className="flex items-center justify-between">
        <Button variant="secondary" disabled={i === 0} onClick={() => setI(i - 1)}>← Previous</Button>
        <span className="text-sm text-ink-500">{i + 1} / {slides.length}</span>
        <Button disabled={i >= slides.length - 1} onClick={() => setI(i + 1)}>Next →</Button>
      </div>
    </div>
  );
}
