"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const SUPPORTED = [".pptx", ".pdf", ".docx", ".md", ".txt"];

export default function LessonImportPanel() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function submit() {
    if (!file) {
      setError("Choose a source file first.");
      return;
    }
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      if (title.trim()) fd.append("title", title.trim());
      const r = await fetch("/api/lessons/import", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(j.error ?? "Import failed.");
        return;
      }
      setSummary(`Imported ${j.slide_count} slide${j.slide_count === 1 ? "" : "s"} from ${j.source_type.toUpperCase()}.`);
      router.push(`/teacher/studio/${j.lesson_id}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mb-6 p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-brand-600">Source import</p>
          <h2 className="text-lg font-semibold text-slate-900">Create a lesson from an existing document or deck</h2>
          <p className="mt-1 text-sm text-slate-600">
            Import PowerPoint, PDF, DOCX, Markdown, or plain text directly into Fusion Studio.
            PPTX keeps one source slide per lesson slide; text-based files are chunked into structured sections.
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Supported: {SUPPORTED.join(" · ")}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1.2fr,1fr,auto]">
        <div>
          <label className="label">Source file</label>
          <input
            className="input w-full"
            type="file"
            accept=".pptx,.pdf,.docx,.md,.markdown,.txt,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file && <p className="mt-1 text-xs text-slate-500">{file.name} · {(file.size / 1024).toFixed(1)} KB</p>}
        </div>
        <div>
          <label className="label">Lesson title override</label>
          <input className="input w-full" value={title} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="flex items-end">
          <button className="btn btn-primary w-full md:w-auto" disabled={busy || !file} onClick={submit}>
            {busy ? "Importing…" : "Import to Studio"}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      {summary && <p className="mt-3 text-sm text-emerald-700">{summary}</p>}
    </section>
  );
}
