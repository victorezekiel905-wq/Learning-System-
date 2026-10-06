import { fail, ok, requireProfile, withErrorLog } from "@/lib/api";
import { importLessonFromUpload, renderPdfPages } from "@/lib/lesson-import";

export const runtime = "nodejs";
export const maxDuration = 300;
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 80;

/**
 * POST multipart {file, title?, mode?} → a new draft lesson.
 * PDF (default mode "pictures"): one picture slide per page, so the deck looks exactly
 * like the original, with the page's text as teacher notes and alt text.
 * Everything else, or mode "text": one editable text slide per slide/section.
 */
export const POST = withErrorLog(async function POST(req: Request) {
  const { sb, me, response } = await requireProfile(["teacher", "school_admin", "platform_admin"]);
  if (response) return response;
  if (!me.tenant_id) return fail(400, "Lessons belong to a school. Sign in with a teacher or school admin account.");

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail(400, "Attach a file.");
  if (file.size > MAX_BYTES) return fail(413, "Files must be 20 MB or smaller.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
  const formTitle = String(form?.get("title") ?? "").trim();
  const baseTitle = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Imported lesson";

  if (isPdf && form?.get("mode") !== "text") {
    let rendered;
    try {
      rendered = await renderPdfPages(bytes, { maxPages: MAX_PAGES });
    } catch (e) {
      return fail(422, `Could not read that PDF${e instanceof Error && e.message ? `: ${e.message}` : "."}`);
    }
    if (!rendered.pages.length) return fail(422, "That PDF has no pages.");

    const { data: lesson, error } = await sb.from("lessons")
      .insert({ tenant_id: me.tenant_id, owner_id: me.id, title: (formTitle || baseTitle).slice(0, 200), description: `Imported from ${file.name}` })
      .select("id").single();
    if (error) return fail(400, error.message);

    const uploaded: string[] = [];
    try {
      const slides = [];
      const media = [];
      for (const p of rendered.pages) {
        const path = `${me.tenant_id}/${me.id}/${crypto.randomUUID()}-page-${p.page}.jpg`;
        const { error: upErr } = await sb.storage.from("lesson-media").upload(path, p.jpeg, { contentType: "image/jpeg", upsert: false });
        if (upErr) throw new Error(upErr.message);
        uploaded.push(path);
        const firstLine = p.text.split("\n").find((l) => l.trim())?.trim() ?? "";
        const alt = (p.text ? p.text.replace(/\s+/g, " ") : `Slide ${p.page} of ${baseTitle}`).slice(0, 300);
        media.push({ tenant_id: me.tenant_id, owner_id: me.id, lesson_id: lesson.id, storage_path: path, kind: "image",
                     mime_type: "image/jpeg", bytes: p.jpeg.length, title: `${baseTitle} – slide ${p.page}`, alt_text: alt });
        slides.push({ tenant_id: me.tenant_id, lesson_id: lesson.id, position: p.page - 1, kind: "image",
                      content: { media_path: path, alt, full: true, ...(firstLine ? { heading: firstLine.slice(0, 120) } : {}) },
                      notes: p.text || null });
      }
      const m = await sb.from("lesson_media").insert(media);
      if (m.error) throw new Error(m.error.message);
      const s = await sb.from("lesson_slides").insert(slides);
      if (s.error) throw new Error(s.error.message);
      return ok({ lesson_id: lesson.id, slides: slides.length, source: "pdf", pictures: true,
                  skipped: Math.max(0, rendered.total - rendered.pages.length) });
    } catch (e) {
      // Leave nothing half-imported behind.
      if (uploaded.length) await sb.storage.from("lesson-media").remove(uploaded);
      await sb.from("lessons").delete().eq("id", lesson.id);
      return fail(400, e instanceof Error ? e.message : "Import failed.");
    }
  }

  let parsed;
  try {
    parsed = await importLessonFromUpload({ filename: file.name, mimeType: file.type, bytes });
  } catch (e) {
    return fail(422, e instanceof Error ? e.message : "Could not read that file.");
  }

  const title = (formTitle || parsed.title).slice(0, 200);
  const { data: lesson, error } = await sb.from("lessons")
    .insert({ tenant_id: me.tenant_id, owner_id: me.id, title, description: `Imported from ${file.name}` })
    .select("id").single();
  if (error) return fail(400, error.message);

  const rows = parsed.slides.map((s, i) => ({
    tenant_id: me.tenant_id, lesson_id: lesson.id, position: i,
    kind: i === 0 ? "title" : "text",
    content: i === 0 ? { heading: s.title, body: s.body.slice(0, 280) } : { heading: s.title, body: s.body },
    notes: `Imported (${parsed.sourceType})`
  }));
  const { error: slideErr } = await sb.from("lesson_slides").insert(rows);
  if (slideErr) return fail(400, slideErr.message);
  return ok({ lesson_id: lesson.id, slides: rows.length, source: parsed.sourceType, pictures: false, skipped: 0 });
});
