import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { importLessonFromUpload } from "@/lib/lesson-import";

export async function POST(req: NextRequest) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { data: me } = await sb.from("users").select("id,tenant_id").eq("id", user.id).maybeSingle();
  if (!me) return NextResponse.json({ error: "profile not set up — call /api/auth/setup first" }, { status: 400 });

  const form = await req.formData();
  const file = form.get("file");
  const titleOverride = String(form.get("title") ?? "").trim();
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const imported = await importLessonFromUpload({
    filename: file.name,
    mimeType: file.type,
    bytes
  });

  const lessonTitle = titleOverride || imported.title;
  const { data: lesson, error: lessonError } = await sb.from("lessons").insert({
    tenant_id: me.tenant_id,
    owner_id: me.id,
    title: lessonTitle,
    description: `Imported from ${file.name} (${imported.sourceType.toUpperCase()})`,
    status: "draft",
    mode: "live_participation"
  }).select("id,title").single();
  if (lessonError) return NextResponse.json({ error: lessonError.message }, { status: 400 });

  const slideRows = imported.slides.map((slide, idx) => {
    if (slide.kind === "title") {
      return {
        lesson_id: lesson.id,
        idx,
        kind: "title",
        payload: {
          heading: slide.title,
          subheading: stripHtml(slide.body),
          import_source: slide.source
        }
      };
    }
    return {
      lesson_id: lesson.id,
      idx,
      kind: slide.kind,
      payload: {
        title: slide.title,
        body: slide.body,
        html: slide.body,
        import_source: slide.source
      }
    };
  });

  const { error: slidesError } = await sb.from("lesson_slides").insert(slideRows);
  if (slidesError) return NextResponse.json({ error: slidesError.message, lesson_id: lesson.id }, { status: 400 });

  await sb.from("lesson_versions").insert({
    lesson_id: lesson.id,
    version: 1,
    snapshot: {
      source_file: file.name,
      source_type: imported.sourceType,
      slide_count: imported.slideCount,
      imported_at: new Date().toISOString(),
      slides: imported.slides.map((slide, idx) => ({ idx, title: slide.title, kind: slide.kind, source: slide.source }))
    }
  });

  await sb.from("audit_logs").insert({
    tenant_id: me.tenant_id,
    actor_id: me.id,
    action: "lesson.imported",
    target: lesson.id,
    meta: { filename: file.name, source_type: imported.sourceType, slide_count: imported.slideCount }
  });

  return NextResponse.json({
    lesson_id: lesson.id,
    title: lesson.title,
    slide_count: imported.slideCount,
    source_type: imported.sourceType
  });
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
