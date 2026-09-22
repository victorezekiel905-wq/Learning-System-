"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const KINDS = ["multiple_choice","open_ended","poll","draw","fill_blank","matching","drag_drop","collab_board","code"] as const;

export default function ActivityForm({ lessons }: { lessons: { id: string; title: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [lessonId, setLessonId] = useState(lessons[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<typeof KINDS[number]>("multiple_choice");
  const [prompt, setPrompt] = useState("");
  const [opts, setOpts] = useState("Yes\nNo\nMaybe");
  const [correct, setCorrect] = useState("Yes");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await fetch("/api/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lesson_id: lessonId, title, kind,
        question: { prompt, options: opts.split("\n").filter(Boolean), correct }
      })
    });
    setBusy(false);
    if (!r.ok) { alert("Failed"); return; }
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="label">Lesson</label>
        <select className="input" value={lessonId} onChange={(e)=>setLessonId(e.target.value)}>
          {lessons.length === 0 && <option value="">(create a lesson first)</option>}
          {lessons.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Title</label>
        <input className="input" required value={title} onChange={(e)=>setTitle(e.target.value)} />
      </div>
      <div>
        <label className="label">Type</label>
        <select className="input" value={kind} onChange={(e)=>setKind(e.target.value as typeof KINDS[number])}>
          {KINDS.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Question prompt</label>
        <textarea className="input" rows={2} value={prompt} onChange={(e)=>setPrompt(e.target.value)} />
      </div>
      <div>
        <label className="label">Options (one per line)</label>
        <textarea className="input" rows={3} value={opts} onChange={(e)=>setOpts(e.target.value)} />
      </div>
      <div>
        <label className="label">Correct answer (must match an option)</label>
        <input className="input" value={correct} onChange={(e)=>setCorrect(e.target.value)} />
      </div>
      <button className="btn btn-primary w-full" disabled={busy || lessons.length === 0}>
        {busy ? "Saving…" : "Save activity + question"}
      </button>
    </form>
  );
}
