"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { errorText, rpc, must } from "@/lib/rpc";
import { Alert, Button, Field, Input, Modal, Select, Tabs, Toggle } from "@/components/ui";

export function NewLessonButton({ openInitially, templates }: { openInitially?: boolean; templates: { id: string; title: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(!!openInitially);
  const [tab, setTab] = useState<"blank" | "template" | "import">("blank");
  const [title, setTitle] = useState("");
  const [subject, setSubject] = useState("");
  const [template, setTemplate] = useState(templates[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [keepLook, setKeepLook] = useState(true);
  // PDFs, and PowerPoint where the server has LibreOffice, become picture slides that keep the design.
  const isPdf = !!file && /\.(pdf|pptx|ppt|ppsx|odp)$/i.test(file.name);
  const [note, setNote] = useState<{ id: string; text: string } | null>(null);
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
        form.append("mode", isPdf && keepLook ? "pictures" : "text");
        const res = await fetch("/api/lessons/import", { method: "POST", body: form });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Import failed");
        id = body.lesson_id;
        if (body.note) { setNote({ id, text: body.note }); setBusy(false); return; }
      } else {
        const sb = createClient();
        const { data: { user } } = await sb.auth.getUser();
        const { data: me } = await sb.from("users").select("tenant_id").eq("id", user!.id).maybeSingle();
        if (!me?.tenant_id) throw new Error("Lessons belong to a school. Sign in with a teacher or school admin account.");
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
            <div className="space-y-3">
              <Field label="Your slides" hint="PDF, PowerPoint, Word, Markdown or text. Up to 20 MB and 80 slides.">
                <input type="file" accept=".pdf,.pptx,.ppt,.ppsx,.odp,.docx,.md,.markdown,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ink-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white" />
              </Field>
              {isPdf ? (
                <Toggle checked={keepLook} onChange={setKeepLook} label="Keep the original look"
                  description={keepLook ? "Every slide keeps its design, exactly as in your file. Add quizzes, polls and other activities between them afterwards." : "Slides become plain text you can edit word by word."} />
              ) : (
                <Alert title="Google Slides or Canva?">
                  Download as PDF or PowerPoint and import that. Google Slides: <b>File → Download</b>. Canva: <b>Share → Download</b>. {file ? "Word and text files become editable text slides." : ""}
                </Alert>
              )}
              {busy && <p className="text-sm text-ink-600">Importing… a long deck can take up to a minute.</p>}
              {note && <Alert tone="warn" title="Imported as text">{note.text} <a href={`/teacher/lessons/${note.id}`} className="font-semibold">Open the lesson</a></Alert>}
            </div>
          )}
          {err && <Alert tone="error">{err}</Alert>}
        </div>
      </Modal>
    </>
  );
}
