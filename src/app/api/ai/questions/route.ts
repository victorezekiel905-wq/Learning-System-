import { fail, ok, readJson, requireProfile, withErrorLog } from "@/lib/api";
import { AI_KINDS, AiUnavailable, draftQuestions } from "@/lib/ai-questions";
import { allowShared } from "@/lib/rate-limit";
import { TEACHERS } from "@/lib/session";

// Long PDFs take a while to read.
export const maxDuration = 120;

const MAX_PDF_BYTES = 12 * 1024 * 1024;

/**
 * "Write with AI" in Import questions: drafts questions from a topic, pasted notes
 * or a PDF. Returns them for the teacher to check in the import preview; nothing
 * is saved here.
 */
export const POST = withErrorLog(async function POST(req: Request) {
  const { me, response } = await requireProfile(TEACHERS);
  if (response) return response;
  // Each draft costs money: a few a minute per teacher, and a ceiling per school.
  if (!(await allowShared(`ai-q:${me.id}`, 4)) || !(await allowShared(`ai-q-school:${me.tenant_id}`, 30))) {
    return fail(429, "You've asked for a lot of questions in a short time. Wait a minute and try again.");
  }
  const body = await readJson<{ topic?: string; text?: string; pdf?: string; level?: string; subject?: string; count?: number; kinds?: string[] }>(req, 17_000_000);
  if (!body) return fail(400, "Send a topic, some notes or a PDF.");
  const topic = body.topic?.trim().slice(0, 300) || undefined;
  const text = body.text?.trim().slice(0, 60_000) || undefined;
  const pdf = body.pdf?.replace(/^data:application\/pdf;base64,/, "").replace(/\s/g, "") || undefined;
  if (!topic && !text && !pdf) return fail(400, "Type a topic, paste some notes, or choose a PDF.");
  if (pdf && pdf.length * 0.75 > MAX_PDF_BYTES) return fail(413, "That PDF is too big. Use one under 12 MB, or paste the part you need.");
  const level = body.level?.trim().slice(0, 60) || "a secondary school class";
  const count = Math.min(20, Math.max(1, Math.round(Number(body.count) || 10)));
  const kinds = (body.kinds ?? []).filter((k): k is (typeof AI_KINDS)[number] => (AI_KINDS as readonly string[]).includes(k));
  try {
    const questions = await draftQuestions({ source: { topic, text, pdfBase64: pdf }, level, subject: body.subject?.trim().slice(0, 60) || undefined, count, kinds });
    if (!questions.length) return fail(422, "No usable questions came back. Try a clearer topic or different notes.");
    return ok({ questions });
  } catch (e) {
    if (e instanceof AiUnavailable) return fail(503, e.message);
    throw e;
  }
});
