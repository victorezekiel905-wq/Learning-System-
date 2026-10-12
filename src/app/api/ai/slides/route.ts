import { fail, ok, readJson, requireProfile, withErrorLog } from "@/lib/api";
import { findPhoto, outlineSlides, photosConfigured, SlidesUnavailable } from "@/lib/ai-slides";
import { allowShared } from "@/lib/rate-limit";
import { TEACHERS } from "@/lib/session";
import { buildDeck, THEMES, tidyOutline, type ThemeKey } from "@/slides/ai-deck";

export const maxDuration = 120;

/**
 * "Create slides with AI": a topic (and optionally the teacher's notes) in, designed
 * slides out, for the teacher to check. Nothing is saved here: the page adds them to
 * a lesson, or downloads them, when the teacher chooses.
 */
export const POST = withErrorLog(async function POST(req: Request) {
  const { me, response } = await requireProfile(TEACHERS);
  if (response) return response;
  if (!(await allowShared(`ai-s:${me.id}`, 4)) || !(await allowShared(`ai-s-school:${me.tenant_id}`, 30))) {
    return fail(429, "You've made a lot of slides in a short time. Wait a minute and try again.");
  }
  const body = await readJson<{ topic?: string; level?: string; subject?: string; count?: number; notes?: string; pictures?: boolean; theme?: string }>(req, 200_000);
  const topic = body?.topic?.trim().slice(0, 200);
  if (!topic) return fail(400, "Type what the lesson is about.");
  const count = Math.min(15, Math.max(4, Math.round(Number(body?.count) || 8)));
  const theme: ThemeKey = body?.theme && body.theme in THEMES ? (body.theme as ThemeKey) : "swift";
  const pictures = body?.pictures !== false && photosConfigured();
  try {
    const outline = tidyOutline(await outlineSlides({
      topic, count, pictures,
      level: body?.level?.trim().slice(0, 60) || "a secondary school class",
      subject: body?.subject?.trim().slice(0, 60) || undefined,
      notes: body?.notes?.trim().slice(0, 30_000) || undefined
    }), count);
    // Photos one after another, so no two slides get the same one.
    const used = new Set<string>();
    const photos = [];
    for (const s of outline.slides) {
      const wants = pictures && !!s.image_query && ["title", "picture", "big_picture"].includes(s.layout);
      photos.push(wants ? await findPhoto(s.image_query!, used) : undefined);
    }
    return ok({ title: outline.title, slides: buildDeck(outline, photos, theme), pictures });
  } catch (e) {
    if (e instanceof SlidesUnavailable) return fail(503, e.message);
    throw e;
  }
});
