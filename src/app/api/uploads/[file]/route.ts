import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Secure media proxy for the lessons storage bucket. Returns a short-lived signed
// URL when the bucket is private; otherwise falls back to the bucket public URL.
export async function GET(_req: NextRequest, { params }: { params: { file: string } }) {
  const sb = createClient();
  const path = decodeURIComponent(params.file);

  const signed = await sb.storage.from("lessons").createSignedUrl(path, 60 * 10);
  if (signed.data?.signedUrl) {
    return NextResponse.redirect(signed.data.signedUrl, 307);
  }

  const publicUrl = sb.storage.from("lessons").getPublicUrl(path).data.publicUrl;
  if (publicUrl) return NextResponse.redirect(publicUrl, 307);

  return NextResponse.json({ error: "file not found" }, { status: 404 });
}
