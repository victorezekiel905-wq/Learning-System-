"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { errorText, rpc, must } from "@/lib/rpc";
import { Alert, Button, Field, Input, Modal, Select, Tabs } from "@/components/ui";

export function NewLessonButton({ openInitially, templates }: { openInitially?: boolean; templates: { id: string; title: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(!!openInitially);
  const [tab, setTab] = useState<"blank" | "template" | "import">("blank");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [template, setTemplate] = useState(templates[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setBusy(true); setErr(null);
    try {
      let id: string;
      if (tab === "template") {
        id = await rpc<string>("duplicate_lesson", { p_lesson: template, p_title: title || null });
      } else if (tab === "import") {
        if (!file) throw new Error("Choose a file to import.");
        const form = new FormData();
        form.append("file", file);
        if (title) form.append("title", title);
        const res = await fetch("/api/lessons/import", { method: "POST", body: form });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Import failed");
        id = body.lesson_id;
      } else {
        const sb = createClient();
        const { data: { user } } = await sb.auth.getUser();
        const { data: me } = await sb.from("users").select("tenant_id").eq("id", user!.id).single();
        const { data, error } = await sb.from("lessons").insert({ tenant_id: me!.tenant_id, owner_id: user!.id, title: title.trim(), subject: subject || null }).select("id").single();
        if (error) throw new Error(error.message);
        id = data.id;
        must(await sb.from("lesson_slides").insert({ tenant_id: me!.tenant_id, lesson_id: id, position: 0, kind: "title", content: { heading: title.trim() } }));
      }
      router.push(`/teacher/lessons/${id}`);
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>New lesson</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="New lesson"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button loading={busy} onClick={create} disabled={(tab === "blank" && !title.trim()) || (tab === "import" && !file) || (tab === "template" && !template)}>Create</Button></>}>
        <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[{ id: "blank", label: "Blank" }, { id: "template", label: "From template" }, { id: "import", label: "Import file" }]} />
        <div className="space-y-4">
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tab === "blank" ? "Introduction to HTML" : "Optional"} /></Field>
          {tab === "blank" && <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>}
          {tab === "template" && (templates.length ? (
            <Field label="Template"><Select value={template} onChange={(e) => setTemplate(e.target.value)}>{templates.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</Select></Field>
          ) : <Alert>No templates yet. Open any lesson and choose "Save as template".</Alert>)}
          {tab === "import" && (
            <Field label="PowerPoint, PDF, Word, Markdown or text" hint="Text is turned into editable slides. Up to 20 MB, 80 slides.">
              <input type="file" accept=".pptx,.pdf,.docx,.md,.markdown,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
          )}
          {err && <Alert tone="error">{err}</Alert>}
        </div>
      </Modal>
    </>
  );
}
