import { ok, readJson, requireProfile, withErrorLog } from "@/lib/api";
import { reportPhotoUse } from "@/lib/ai-slides";
import { TEACHERS } from "@/lib/session";

/** Tells Unsplash which photos were used (added to a lesson or downloaded), as its rules ask. */
export const POST = withErrorLog(async function POST(req: Request) {
  const { response } = await requireProfile(TEACHERS);
  if (response) return response;
  const body = await readJson<{ locations?: string[] }>(req, 20_000);
  await reportPhotoUse(Array.isArray(body?.locations) ? body!.locations.filter((l): l is string => typeof l === "string") : []);
  return ok({ done: true });
});
