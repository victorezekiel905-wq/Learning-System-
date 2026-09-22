import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type RawSlide = {
  id: string;
  idx: number;
  kind: string;
  payload: Record<string, unknown> | null;
  created_at?: string;
};

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: slides, error } = await sb.from("lesson_slides")
    .select("id,idx,kind,payload,created_at")
    .eq("lesson_id", params.id)
    .order("idx");
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(((slides ?? []) as RawSlide[]).map((slide: RawSlide) => flattenSlide(slide)));
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const body = await req.json();

  const normalized = normalizeIncomingSlide(body);
  const { data, error } = await sb.from("lesson_slides").insert({
    lesson_id: params.id,
    idx: normalized.idx,
    kind: normalized.kind,
    payload: normalized.payload
  }).select("id,idx,kind,payload,created_at").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(flattenSlide(data as RawSlide));
}

function normalizeIncomingSlide(body: Record<string, unknown>) {
  const incomingKind = String(body.kind ?? "html");
  const idx = typeof body.idx === "number"
    ? body.idx
    : typeof body.index === "number"
      ? body.index
      : 0;

  if (incomingKind === "image") {
    return {
      idx,
      kind: "image",
      payload: {
        title: String(body.title ?? "Image slide"),
        body: String(body.body ?? ""),
        url: String(body.media_url ?? body.url ?? ""),
        alt: String(body.title ?? "Image slide")
      }
    };
  }

  if (incomingKind === "video") {
    return {
      idx,
      kind: "video",
      payload: {
        title: String(body.title ?? "Video slide"),
        body: String(body.body ?? ""),
        url: String(body.media_url ?? body.url ?? "")
      }
    };
  }

  return {
    idx,
    kind: "embed",
    payload: {
      title: String(body.title ?? "Untitled slide"),
      body: String(body.body ?? ""),
      html: String(body.body ?? ""),
      media_url: typeof body.media_url === "string" ? body.media_url : null
    }
  };
}

function flattenSlide(slide: RawSlide) {
  const payload = slide.payload ?? {};
  return {
    id: slide.id,
    idx: slide.idx,
    created_at: slide.created_at,
    kind: slide.kind === "embed" ? "html" : slide.kind,
    title: String(payload.title ?? payload.heading ?? "Untitled"),
    body: String(payload.body ?? payload.markdown ?? payload.html ?? ""),
    media_url: String(payload.media_url ?? payload.url ?? ""),
    payload
  };
}
