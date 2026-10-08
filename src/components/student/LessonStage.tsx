"use client";
import { ActivityPlayer } from "@/components/activities/ActivityPlayer";
import type { LiveTimer } from "@/components/game/LiveGame";
import { InteractiveVideo } from "@/components/slides/InteractiveVideo";
import { SlideView, type SlideData } from "@/components/slides/SlideView";

export type LearnerSlide = SlideData & {
  activity: (SlideData["activity"] & { settings?: Record<string, unknown> }) | null;
  checkpoints?: { id: string; t_seconds: number; required: boolean; question_id: string; activity_id: string }[];
};

/** Renders one slide for a learner, wiring activities and interactive video to the attempt engine. */
export function LessonStage({ slide, sessionId, shareCode, tenantId, userId, overlay, live }: {
  slide: LearnerSlide; sessionId?: string; shareCode?: string; tenantId: string; userId: string; overlay?: React.ReactNode;
  /** Teacher-paced live lesson: game tiles and the class countdown. */
  live?: { timer: LiveTimer | null; skew: number };
}) {
  if (slide.kind === "video" && slide.checkpoints?.length) {
    return <InteractiveVideo slide={slide} checkpoints={slide.checkpoints} sessionId={sessionId} shareCode={shareCode} />;
  }
  if (slide.kind === "activity" && slide.activity) {
    return (
      <SlideView slide={slide} activitySlot={
        <ActivityPlayer key={`${slide.activity.id}:${sessionId ?? shareCode}`} activityId={slide.activity.id} sessionId={sessionId} shareCode={shareCode}
          tenantId={tenantId} userId={userId} live={live} />
      } />
    );
  }
  return <SlideView slide={slide} overlay={overlay} />;
}
