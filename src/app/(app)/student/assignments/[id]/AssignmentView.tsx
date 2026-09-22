"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActivityPlayer } from "@/components/activities/ActivityPlayer";
import { RichText } from "@/components/RichText";
import { Alert, Badge, Button, Card, Field, PageHeader, Textarea, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { errorText, rpc } from "@/lib/rpc";
import { formatDateTime } from "@/lib/utils";

type Assignment = { id: string; title: string; instructions: string | null; due_at: string | null; allow_late: boolean; max_resubmissions: number; points_possible: number; activity_id: string | null; classes: { name: string } | null };
type Sub = { id: string; attempt_no: number; body: string | null; files: { path: string; name: string }[]; status: string; is_late: boolean; submitted_at: string; grades: { score: number; feedback: string | null; released_at: string | null } | { score: number; feedback: string | null; released_at: string | null }[] | null };

export function AssignmentView({ assignment: a, submissions, me }: { assignment: Assignment; submissions: Sub[]; me: { id: string; tenantId: string } }) {
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<{ path: string; name: string; bytes: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const overdue = a.due_at && new Date(a.due_at) < new Date();
  const closed = overdue && !a.allow_late;
  const left = a.max_resubmissions + 1 - submissions.length;

  async function upload(f: File) {
    if (f.size > 50 * 1024 * 1024) { toast("Files must be under 50 MB.", "error"); return; }
    const path = `${me.tenantId}/${me.id}/${a.id}/${crypto.randomUUID()}-${f.name.replace(/[^A-Za-z0-9._-]+/g, "_")}`;
    const { error } = await createClient().storage.from("submissions").upload(path, f);
    if (error) toast(error.message, "error"); else setFiles((x) => [...x, { path, name: f.name, bytes: f.size }]);
  }

  async function submit() {
    setBusy(true);
    try { await rpc("submit_assignment", { p_assignment: a.id, p_body: body, p_files: files }); toast("Submitted", "success"); setBody(""); setFiles([]); router.refresh(); }
    catch (e) { toast(errorText(e), "error"); }
    setBusy(false);
  }

  return (
    <div className="page max-w-4xl space-y-5">
      <PageHeader eyebrow={a.classes?.name} title={a.title}
        subtitle={<>{a.due_at ? `Due ${formatDateTime(a.due_at)}` : "No due date"} · {a.points_possible} points{overdue && (a.allow_late ? " · late work accepted" : " · closed")}</>} />
      {a.instructions && <Card><RichText text={a.instructions} /></Card>}

      {a.activity_id ? (
        <ActivityPlayer activityId={a.activity_id} assignmentId={a.id} tenantId={me.tenantId} userId={me.id} onFinished={() => router.refresh()} />
      ) : closed ? <Alert tone="warn">This assignment is closed.</Alert> : left <= 0 ? <Alert>You've used all your submissions.</Alert> : (
        <Card title={submissions.length ? `Resubmit (${left} left)` : "Your submission"}>
          <div className="space-y-3">
            <Field label="Answer / notes"><Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
            <Field label="Attachments">
              <input type="file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
              {files.length > 0 && <ul className="mt-2 text-sm">{files.map((f) => <li key={f.path}>📎 {f.name}</li>)}</ul>}
            </Field>
            <Button loading={busy} disabled={!body.trim() && !files.length} onClick={submit}>Submit</Button>
          </div>
        </Card>
      )}

      {submissions.length > 0 && (
        <Card title="Submission history">
          <ul className="space-y-3">{submissions.map((s) => {
            const g = Array.isArray(s.grades) ? s.grades[0] : s.grades;
            return (
              <li key={s.id} className="rounded-lg border border-ink-200 p-3 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-medium">Attempt {s.attempt_no} <span className="text-xs text-ink-500">{formatDateTime(s.submitted_at)}</span>{s.is_late && <Badge tone="amber">late</Badge>}<Badge>{s.status}</Badge></p>
                {s.body && <p className="mt-1 whitespace-pre-wrap text-ink-700">{s.body}</p>}
                {s.files?.map((f) => <FileLink key={f.path} f={f} />)}
                {g?.released_at && <Alert tone="success" title={`Grade: ${Number(g.score)} / ${a.points_possible}`}>{g.feedback ?? "No written feedback."}</Alert>}
              </li>
            );
          })}</ul>
        </Card>
      )}
    </div>
  );
}

function FileLink({ f }: { f: { path: string; name: string } }) {
  return (
    <button className="mt-1 block text-left text-sm font-medium text-brand-700 underline" onClick={async () => {
      const { data } = await createClient().storage.from("submissions").createSignedUrl(f.path, 300);
      if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
    }}>📎 {f.name}</button>
  );
}
