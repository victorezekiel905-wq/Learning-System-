"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, Input, Modal, Select, Textarea, Toggle } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export function NewAssignment({ classes, activities, rubrics }: { classes: { id: string; name: string }[]; activities: { id: string; title: string; kind: string }[]; rubrics: { id: string; title: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ class_id: classes[0]?.id ?? "", title: "", instructions: "", activity_id: "", rubric_id: "", due_at: "", allow_late: true, max_resubmissions: 0, points_possible: 100, status: "published" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true); setErr(null);
    const sb = createClient();
    const { data: { user } } = await sb.auth.getUser();
    const { data: me } = await sb.from("users").select("tenant_id").eq("id", user!.id).single();
    const { data, error } = await sb.from("assignments").insert({
      tenant_id: me!.tenant_id, class_id: f.class_id, title: f.title.trim(), instructions: f.instructions || null,
      activity_id: f.activity_id || null, rubric_id: f.rubric_id || null, due_at: f.due_at ? new Date(f.due_at).toISOString() : null,
      allow_late: f.allow_late, max_resubmissions: f.max_resubmissions, points_possible: f.points_possible, status: f.status, created_by: user!.id
    }).select("id").single();
    setBusy(false);
    if (error) { setErr(error.message); return; }
    router.push(`/teacher/assignments/${data.id}`);
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={!classes.length}>New assignment</Button>
      <Modal open={open} onClose={() => setOpen(false)} wide title="New assignment"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} disabled={!f.title.trim() || !f.class_id} onClick={create}>Create</Button></>}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Class"><Select value={f.class_id} onChange={(e) => setF({ ...f, class_id: e.target.value })}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Instructions" className="md:col-span-2"><Textarea rows={4} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} /></Field>
          <Field label="Activity (optional)" hint="Leave empty for a written/file submission."><Select value={f.activity_id} onChange={(e) => setF({ ...f, activity_id: e.target.value })}>
            <option value="">Written or file submission</option>{activities.map((a) => <option key={a.id} value={a.id}>{a.title} ({a.kind.replace(/_/g, " ")})</option>)}
          </Select></Field>
          <Field label="Rubric"><Select value={f.rubric_id} onChange={(e) => setF({ ...f, rubric_id: e.target.value })}><option value="">None</option>{rubrics.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}</Select></Field>
          <Field label="Due"><Input type="datetime-local" value={f.due_at} onChange={(e) => setF({ ...f, due_at: e.target.value })} /></Field>
          <Field label="Points"><Input type="number" min={0} value={f.points_possible} onChange={(e) => setF({ ...f, points_possible: Number(e.target.value) })} /></Field>
          <Field label="Resubmissions allowed"><Input type="number" min={0} max={20} value={f.max_resubmissions} onChange={(e) => setF({ ...f, max_resubmissions: Number(e.target.value) })} /></Field>
          <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="published">Published (students can see it)</option><option value="draft">Draft</option></Select></Field>
          <Toggle checked={f.allow_late} onChange={(v) => setF({ ...f, allow_late: v })} label="Accept late work" description="Late submissions are flagged." />
          {err && <div className="md:col-span-2"><Alert tone="error">{err}</Alert></div>}
        </div>
      </Modal>
    </>
  );
}
