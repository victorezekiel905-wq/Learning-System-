"use client";
import { useEffect, useState } from "react";
import { createClient } from "./supabase/client";

const cache = new Map<string, { url: string; exp: number }>();

/** Short-lived signed URL for a private lesson-media object (tenant-scoped by storage RLS). */
export async function signedUrl(path: string, bucket = "lesson-media"): Promise<string | null> {
  const key = `${bucket}:${path}`;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now() + 60_000) return hit.url;
  const { data } = await createClient().storage.from(bucket).createSignedUrl(path, 3600);
  if (!data?.signedUrl) return null;
  cache.set(key, { url: data.signedUrl, exp: Date.now() + 3600_000 });
  return data.signedUrl;
}

export function useSignedUrl(path: string | null | undefined, bucket = "lesson-media") {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!path) { setUrl(null); return; }
    void signedUrl(path, bucket).then((u) => { if (live) setUrl(u); });
    return () => { live = false; };
  }, [path, bucket]);
  return url;
}

export function mediaKind(mime: string): "image" | "video" | "audio" | "document" | "other" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (/pdf|presentation|word|text\//.test(mime)) return "document";
  return "other";
}

/** Downscale images before upload (§33 compressed images). */
async function compressImage(file: File, maxEdge = 1920, quality = 0.82): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type) || typeof createImageBitmap === "undefined") return file;
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 600_000) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return await new Promise<Blob>((res) => canvas.toBlob((b) => res(b ?? file), "image/jpeg", quality));
}

export type UploadedMedia = { id: string; storage_path: string; kind: string; title: string; mime_type: string };

export async function uploadMedia(file: File, opts: { tenantId: string; userId: string; lessonId?: string; folderId?: string | null; tags?: string[]; alt?: string }): Promise<UploadedMedia> {
  const sb = createClient();
  const body = await compressImage(file);
  const mime = body === file ? file.type || "application/octet-stream" : "image/jpeg";
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(-80);
  const path = `${opts.tenantId}/${opts.userId}/${crypto.randomUUID()}-${safeName}`;
  const { error: upErr } = await sb.storage.from("lesson-media").upload(path, body, { contentType: mime, upsert: false });
  if (upErr) throw new Error(upErr.message);
  const { data, error } = await sb.from("lesson_media").insert({
    tenant_id: opts.tenantId, owner_id: opts.userId, lesson_id: opts.lessonId ?? null, folder_id: opts.folderId ?? null,
    storage_path: path, kind: mediaKind(mime), mime_type: mime, bytes: body.size,
    title: file.name, alt_text: opts.alt ?? null, tags: opts.tags ?? []
  }).select("id,storage_path,kind,title,mime_type").single();
  if (error) {
    await sb.storage.from("lesson-media").remove([path]);
    throw new Error(error.message);
  }
  return data as UploadedMedia;
}

/** YouTube/Vimeo links become privacy-enhanced embeds; everything else must be https. */
export function embedUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    const yt = u.hostname.replace(/^www\./, "");
    if (yt === "youtube.com" && u.searchParams.get("v")) return `https://www.youtube-nocookie.com/embed/${u.searchParams.get("v")}?enablejsapi=1`;
    if (yt === "youtu.be") return `https://www.youtube-nocookie.com/embed${u.pathname}?enablejsapi=1`;
    if (yt === "vimeo.com" && /^\/\d+/.test(u.pathname)) return `https://player.vimeo.com/video${u.pathname}`;
    return u.toString();
  } catch {
    return null;
  }
}

export function isDirectVideo(url: string | undefined) {
  return !!url && /\.(mp4|webm|ogg)(\?|$)/i.test(url);
}
