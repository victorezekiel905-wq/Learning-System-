"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function ChallengeForm({ classes, activities }: {
  classes: { id: string; name: string; join_code: string }[];
  activities: { id: string; title: string; kind: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [activityId, setActivityId] = useState(activities[0]?.id ?? "");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await fetch("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ class_id: classId, quiz_id: activityId })
    });
    setBusy(false);
    if (!r.ok) { alert("Failed to create game"); return; }
    const { id } = await r.json();
    router.push(`/teacher/challenge/${id}`);
  }

  return (
    <form onSubmit={onSubmit} className="card mt-6 space-y-4 p-6">
      <div>
        <label className="label">Class</label>
        <select className="input" value={classId} onChange={(e)=>setClassId(e.target.value)}>
          {classes.length === 0 && <option value="">(create a class first)</option>}
          {classes.map(c => <option key={c.id} value={c.id}>{c.name} — {c.join_code}</option>)}
        </select>
      </div>
      <div>
        <label className="label">Activity / quiz source</label>
        <select className="input" value={activityId} onChange={(e)=>setActivityId(e.target.value)}>
          {activities.length === 0 && <option value="">(create an activity first)</option>}
          {activities.map(a => <option key={a.id} value={a.id}>{a.title} ({a.kind})</option>)}
        </select>
      </div>
      <button className="btn btn-primary" disabled={busy || !classId || !activityId}>{busy ? "Starting…" : "Open lobby"}</button>
    </form>
  );
}
