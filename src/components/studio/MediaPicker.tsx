"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLoader } from "@/lib/hooks";
import { uploadMedia, useSignedUrl } from "@/lib/media";
import { errorText } from "@/lib/rpc";
import { Button, Empty, Input, Modal, useToast, useDialog } from "@/components/ui";

export type MediaRow = { id: string; storage_path: string; kind: string; title: string; mime_type: string; alt_text: string | null; tags: string[]; bytes: number; created_at: string };

function Thumb({ m }: { m: MediaRow }) {
  const url = useSignedUrl(m.kind === "image" ? m.storage_path : null);
  return (
    <div className="grid aspect-video place-items-center overflow-hidden rounded-md bg-ink-100 text-xs text-ink-500">
      {url ? <img src={url} alt={m.alt_text ?? ""} className="h-full w-full object-cover" /> : m.kind.toUpperCase()}
    </div>
  );
}

export function MediaPicker({ open, onClose, onPick, kinds, tenantId, userId, lessonId }: {
  open: boolean; onClose: () => void; onPick: (m: MediaRow) => void; kinds?: string[]; tenantId: string; userId: string; lessonId?: string;
}) {
  const toast = useToast();
  const dialog = useDialog();
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const media = useLoader(async () => {
    let q = createClient().from("lesson_media").select("id,storage_path,kind,title,mime_type,alt_text,tags,bytes,created_at")
      .order("created_at", { ascending: false }).limit(60);
    if (kinds?.length) q = q.in("kind", kinds);
    if (search.trim()) q = q.textSearch("search", search.trim().split(/\s+/).join(" & "), { config: "simple" });
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as MediaRow[];
  }, [search, open, (kinds ?? []).join()], { enabled: open });

  async function upload(file: File) {
    let alt: string | undefined;
    if (file.type.startsWith("image/")) {
      const a = await dialog.ask({ title: "Describe this image", body: "Screen readers read this aloud to students who can't see the image.", label: "Alt text", optional: true, maxLength: 300, confirmLabel: "Upload" });
      if (a === null) return;
      alt = a;
    }
    setBusy(true);
    try {
      await uploadMedia(file, { tenantId, userId, lessonId, alt });
      await media.reload();
      toast("Uploaded", "success");
    } catch (e) { toast(errorText(e), "error"); }
    setBusy(false);
  }

  return (
    <Modal open={open} onClose={onClose} wide title="Media library">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input placeholder="Search title, alt text or tags" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <label className="btn btn-primary cursor-pointer">
          {busy ? "Uploading…" : "Upload"}
          <input type="file" className="sr-only" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
        </label>
      </div>
      {(media.data ?? []).length === 0 ? <Empty title="Nothing here yet">Upload images, video, audio or documents.</Empty> : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(media.data ?? []).map((m) => (
            <button key={m.id} type="button" className="rounded-lg border border-ink-200 p-1.5 text-left hover:border-brand-400" onClick={() => { onPick(m); onClose(); }}>
              <Thumb m={m} />
              <p className="mt-1 truncate text-xs font-medium">{m.title}</p>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

export function MediaThumb({ m }: { m: MediaRow }) {
  return <Thumb m={m} />;
}

export async function deleteMedia(m: MediaRow) {
  const sb = createClient();
  const { error } = await sb.storage.from("lesson-media").remove([m.storage_path]);
  if (error) throw new Error(error.message);
  const res = await sb.from("lesson_media").delete().eq("id", m.id);
  if (res.error) throw new Error(res.error.message);
}

export function PickMediaButton({ label, ...props }: Omit<Parameters<typeof MediaPicker>[0], "open" | "onClose"> & { label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{label}</Button>
      <MediaPicker open={open} onClose={() => setOpen(false)} {...props} />
    </>
  );
}
