import { fail, ok, requireProfile } from "@/lib/api";
import { importLessonFromUpload } from "@/lib/lesson-import";

export const runtime = "nodejs";
const MAX_BYTES = 20 * 1024 * 1024;

/** POST multipart {file, title?} → a new draft lesson with one editable slide per section/slide. */
export async function POST(req: Request) {
  const { sb, me, response } = await requireProfile(["teacher", "school_admin", "platform_admin"]);
  if (response) return response;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail(400, "Attach a file.");
  if (file.size > MAX_BYTES) return fail(413, "Files must be 20 MB or smaller.");

  let parsed;
  try {
    parsed = await importLessonFromUpload({ filename: file.name, mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
  } catch (e) {
    return fail(422, e instanceof Error ? e.message : "Could not read that file.");
  }

  const title = String(form?.get("title") || parsed.title).slice(0, 200);
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
  return ok({ lesson_id: lesson.id, slides: rows.length, source: parsed.sourceType });
}
