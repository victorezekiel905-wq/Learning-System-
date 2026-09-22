"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function NewSessionForm({ classes, lessons, policies }: {
  classes: { id: string; name: string }[];
  lessons: { id: string; title: string }[];
  policies: { id: string; name: string; mode: string }[];
}) {
  const router = useRouter();
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [lessonId, setLessonId] = useState(lessons[0]?.id ?? "");
  const [policyId, setPolicyId] = useState(policies[0]?.id ?? "");
  const [mode, setMode] = useState<"live_participation"|"student_paced"|"front_of_class">("live_participation");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await fetch("/api/class-sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ class_id: classId, lesson_id: lessonId || null, mode })
    });
    setBusy(false);
    if (!r.ok) { alert("Failed"); return; }
    const { id, join_code } = await r.json();
    if (policyId) {
      await fetch(`/api/class-sessions/${id}/environment/start`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy_id: policyId })
      });
    }
    router.push(`/teacher/live/${id}`);
  }

  return (
    <form onSubmit={onSubmit} className="card mt-6 space-y-4 p-6">
      <div>
        <label className="label">Class</label>
        <select className="input" value={classId} onChange={(e)=>setClassId(e.target.value)}>
          {classes.length === 0 && <option value="">(create a class first)</option>}
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Mode</label>
        <select className="input" value={mode} onChange={(e)=>setMode(e.target.value as typeof mode)}>
          <option value="live_participation">Live Participation</option>
          <option value="student_paced">Student-Paced</option>
          <option value="front_of_class">Front-of-Class</option>
        </select>
      </div>
      <div>
        <label className="label">Lesson</label>
        <select className="input" value={lessonId} onChange={(e)=>setLessonId(e.target.value)}>
          <option value="">— none —</option>
          {lessons.map(l => <option key={l.id} value={l.id}>{l.title}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Environment policy</label>
        <select className="input" value={policyId} onChange={(e)=>setPolicyId(e.target.value)}>
          <option value="">— no policy —</option>
          {policies.map(p => <option key={p.id} value={p.id}>{p.name} ({p.mode})</option>)}
        </select>
      </div>
      <button className="btn btn-primary" disabled={busy || !classId}>{busy ? "Starting…" : "Start session"}</button>
    </form>
  );
}
