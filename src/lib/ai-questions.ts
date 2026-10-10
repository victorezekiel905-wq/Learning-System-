import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { toImported } from "./ai-question-shape";
import type { ImportedQuestion } from "./question-import";

/*
 * "Write with AI": Claude drafts questions from a topic, pasted notes or a PDF.
 * They come back in the importer's own shape (ImportedQuestion), so the teacher
 * sees them in the same editable preview as pasted questions and nothing is added
 * until they choose to. Needs ANTHROPIC_API_KEY on the server.
 */

export const AI_KINDS = ["mcq", "multi_select", "true_false", "short", "fill_blank"] as const;
type AiKind = (typeof AI_KINDS)[number];

const Question = z.object({
  kind: z.enum(AI_KINDS),
  prompt: z.string().describe("The question. For fill_blank, mark each blank with ___ (three underscores)."),
  options: z.array(z.object({ label: z.string(), is_correct: z.boolean() }))
    .describe("mcq: 4 options, one correct. multi_select: 4-5 options, two or more correct. true_false: exactly True and False. short and fill_blank: empty."),
  answers: z.array(z.string()).describe("fill_blank: the answer for each blank, in order. short: one model answer. Otherwise empty."),
  explanation: z.string().describe("One or two sentences a student reads after answering: why the right answer is right."),
  topic: z.string().describe("A short topic name for progress reports, e.g. \"Fractions\" or \"Photosynthesis\".")
});
const Output = z.object({ questions: z.array(Question) });

export type AiSource = { topic?: string; text?: string; pdfBase64?: string };
export type AiRequest = { source: AiSource; level: string; subject?: string; count: number; kinds: AiKind[] };

export class AiUnavailable extends Error {}

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

const SYSTEM = `You write classroom questions for SwiftCipher, a live lesson and quiz platform used in schools in Nigeria and elsewhere.

Write questions a good teacher would be glad to use:
- Correct, unambiguous and checkable. Exactly the stated number of correct options. No trick wording, no "all of the above" or "none of the above".
- Pitched at the class level given. Use clear, simple English; use local, everyday contexts (names, money in naira, places) where a context helps.
- Wrong options are plausible: each reflects a real misconception, not a joke.
- Vary what is tested: recall, understanding and application, roughly in that order of frequency.
- When source material is given, base every question on it and stay inside it. Never invent facts beyond it.
- Keep each question short enough to read on a phone in a few seconds.`;

/** Drafts questions with Claude. Throws AiUnavailable for anything the teacher should be told plainly. */
export async function draftQuestions(req: AiRequest): Promise<ImportedQuestion[]> {
  if (!aiConfigured()) throw new AiUnavailable("AI question writing isn't set up on this site yet. Ask your SwiftCipher administrator to add an Anthropic API key.");
  const client = new Anthropic();
  const kinds = req.kinds.length ? req.kinds : (["mcq", "true_false"] as AiKind[]);
  const brief = [
    `Write ${req.count} questions for ${req.level}${req.subject ? `, ${req.subject}` : ""}.`,
    `Use only these question types: ${kinds.join(", ")}. Mix them if more than one is allowed; most should be ${kinds[0]}.`,
    req.source.topic ? `Topic: ${req.source.topic}` : "",
    req.source.text ? `Base the questions on these notes:\n<notes>\n${req.source.text}\n</notes>` : "",
    req.source.pdfBase64 ? "Base the questions on the attached document." : ""
  ].filter(Boolean).join("\n\n");

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  if (req.source.pdfBase64) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: req.source.pdfBase64 } });
  content.push({ type: "text", text: brief });

  let res;
  try {
    res = await client.beta.messages.parse({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { effort: "medium", format: betaZodOutputFormat(Output) },
      // If the main model declines, the API retries on a fallback model in the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default"
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      throw new AiUnavailable("The site's Anthropic API key was refused. Ask your SwiftCipher administrator to check it.");
    }
    if (e instanceof Anthropic.RateLimitError) throw new AiUnavailable("AI question writing is busy right now. Try again in a minute.");
    if (e instanceof Anthropic.BadRequestError) throw new AiUnavailable("That material couldn't be read. Try a shorter text, or a smaller PDF.");
    if (e instanceof Anthropic.APIError) throw new AiUnavailable("AI question writing isn't answering right now. Try again shortly.");
    throw e;
  }
  if (res.stop_reason === "refusal") throw new AiUnavailable("Claude declined to write questions from this material. Try a different topic or text.");
  if (res.stop_reason === "max_tokens") throw new AiUnavailable("That was too much to write at once. Ask for fewer questions.");
  const out = res.parsed_output;
  if (!out) throw new AiUnavailable("The questions came back in an unexpected form. Try again.");
  return out.questions.filter((q) => kinds.includes(q.kind)).slice(0, req.count).map(toImported).filter((q): q is ImportedQuestion => q !== null);
}
