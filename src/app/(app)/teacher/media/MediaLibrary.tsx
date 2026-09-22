"use client";
import { useState } from "react";
import { deleteMedia, MediaThumb, type MediaRow } from "@/components/studio/MediaPicker";
import { Badge, Button, Card, Empty, Field, Input, Modal, Select, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useLoader } from "@/lib/hooks";
import { signedUrl, uploadMedia } from "@/lib/media";
import { errorText } from "@/lib/rpc";

type Folder = { id: string; name: string; parent_id: string | null };

export function MediaLibrary({ me }: { me: { id: string; tenantId: string } }) {
  const toast = useToast();
  const [folder, setFolder] = useState<string>("");
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<(MediaRow & { folder_id?: string | null; owner_id?: string }) | null>(null);

  const folders = useLoader(async () => {
    const { data } = await createClient().from("media_folders").select("id,name,parent_id").order("name");
    return (data ?? []) as Folder[];
  }, []);
  const media = useLoader(async () => {
    let q = createClient().from("lesson_media").select("id,storage_path,kind,title,mime_type,alt_text,tags,bytes,created_at,folder_id,owner_id").order("created_at", { ascending: false }).limit(120);
    if (folder) q = q.eq("folder_id", folder);
    if (kind) q = q.eq("kind", kind);
    if (search.trim()) q = q.textSearch("search", search.trim().split(/\s+/).join(" & "), { config: "simple" });
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as (MediaRow & { folder_id: string | null; owner_id: string })[];
  }, [folder, kind, search]);

  async function upload(files: FileList) {
    setBusy(true);
    for (const f of Array.from(files)) {
      try { await uploadMedia(f, { tenantId: me.tenantId, userId: me.id, folderId: folder || null }); }
      catch (e) { toast(`${f.name}: ${errorText(e)}`, "error"); }
    }
    setBusy(false);
    void media.reload();
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
      <Card title="Folders" actions={<Button size="sm" variant="ghost" onClick={async () => {
        const name = prompt("Folder name");
        if (!name) return;
        const { error } = await createClient().from("media_folders").insert({ tenant_id: me.tenantId, owner_id: me.id, name, parent_id: folder || null });
        if (error) toast(error.message, "error"); else void folders.reload();
      }}>+ New</Button>}>
        <ul className="space-y-1 text-sm">
          <li><button className={`w-full rounded px-2 py-1 text-left ${!folder ? "bg-brand-50 font-semibold" : ""}`} onClick={() => setFolder("")}>All media</button></li>
          {(folders.data ?? []).map((f) => <li key={f.id}><button className={`w-full rounded px-2 py-1 text-left ${folder === f.id ? "bg-brand-50 font-semibold" : ""}`} onClick={() => setFolder(f.id)}>📁 {f.name}</button></li>)}
        </ul>
      </Card>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input placeholder="Search title, alt text, tags" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
          <Select className="w-36" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">All kinds</option>{["image", "video", "audio", "document", "other"].map((k) => <option key={k} value={k}>{k}</option>)}</Select>
          <label className="btn btn-primary ml-auto cursor-pointer">{busy ? "Uploading…" : "Upload"}<input type="file" multiple className="sr-only" disabled={busy} onChange={(e) => { if (e.target.files?.length) void upload(e.target.files); e.target.value = ""; }} /></label>
        </div>
        {(media.data ?? []).length === 0 ? <Empty title="No media here" /> : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
            {(media.data ?? []).map((m) => (
              <button key={m.id} onClick={() => setEdit(m)} className="card p-2 text-left hover:border-brand-300">
                <MediaThumb m={m} />
                <p className="mt-1 truncate text-xs font-medium">{m.title}</p>
                <p className="flex items-center gap-1 text-[10px] text-ink-500"><Badge>{m.kind}</Badge>{(m.bytes / 1048576).toFixed(1)} MB{m.kind === "image" && !m.alt_text && <Badge tone="amber">no alt</Badge>}</p>
              </button>
            ))}
          </div>
        )}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="Media details"
        footer={edit && <>
          {edit.owner_id === me.id && <Button variant="ghost" className="mr-auto text-rose-600" onClick={async () => { try { await deleteMedia(edit); setEdit(null); void media.reload(); } catch (e) { toast(errorText(e), "error"); } }}>Delete</Button>}
          <Button variant="secondary" onClick={async () => { const u = await signedUrl(edit.storage_path); if (u) window.open(u, "_blank", "noopener"); }}>Open</Button>
          <Button onClick={async () => {
            const { error } = await createClient().from("lesson_media").update({ title: edit.title, alt_text: edit.alt_text, tags: edit.tags, folder_id: edit.folder_id ?? null }).eq("id", edit.id);
            if (error) toast(error.message, "error"); else { setEdit(null); void media.reload(); }
          }}>Save</Button></>}>
        {edit && <div className="space-y-3">
          <Field label="Title"><Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
          <Field label="Alt text"><Input value={edit.alt_text ?? ""} onChange={(e) => setEdit({ ...edit, alt_text: e.target.value })} /></Field>
          <Field label="Tags (comma separated)"><Input value={edit.tags.join(", ")} onChange={(e) => setEdit({ ...edit, tags: e.target.value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) })} /></Field>
          <Field label="Folder"><Select value={edit.folder_id ?? ""} onChange={(e) => setEdit({ ...edit, folder_id: e.target.value || null })}><option value="">None</option>{(folders.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>
        </div>}
      </Modal>
    </div>
  );
}
