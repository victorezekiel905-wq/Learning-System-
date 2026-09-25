"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { RichText } from "@/components/RichText";
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Textarea, Toggle, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { errorText, rpc } from "@/lib/rpc";
import { formatDateTime } from "@/lib/utils";
import { Icon } from "@/components/Icon";

type Criterion = { id: string; title: string; levels: { label: string; points: number; description?: string }[] };
type Assignment = { id: string; title: string; instructions: string | null; due_at: string | null; points_possible: number; status: string; allow_late: boolean; max_resubmissions: number; activity_id: string | null; classes: { name: string } | null; rubrics: { id: string; title: string; criteria: Criterion[] } | null };
type Grade = { score: number; feedback: string | null; released_at: string | null; rubric_scores: Record<string, number> };
type Sub = { id: string; student_id: string; attempt_no: number; body: string | null; files: { path: string; name: string }[]; status: string; is_late: boolean; submitted_at: string; users: { full_name: string } | null; grades: Grade | Grade[] | null; quiz_attempts: { score: number | null; max_score: number | null; status: string } | null };

const one = <T,>(x: T | T[] | null): T | null => (Array.isArray(x) ? x[0] ?? null : x);

export function AssignmentGrader({ assignment: a, submissions, roster }: { assignment: Assignment; submissions: Sub[]; roster: { user_id: string; users: { full_name: string } | null }[] }) {
  const router = useRouter();
  const toast = useToast();
  const latest = useMemo(() => {
    const m = new Map<string, Sub>();
    for (const s of submissions) if (!m.has(s.student_id) || m.get(s.student_id)!.attempt_no < s.attempt_no) m.set(s.student_id, s);
    return m;
  }, [submissions]);
  const [sel, setSel] = useState<string | null>(submissions[0]?.id ?? null);
  const current = submissions.find((s) => s.id === sel);
  const missing = roster.filter((r) => !latest.has(r.user_id));

  async function setStatus(status: string) {
    const { error } = await createClient().from("assignments").update({ status }).eq("id", a.id);
    if (error) toast(error.message, "error"); else router.refresh();
  }

  return (
    <div className="page space-y-5">
      <PageHeader eyebrow={<Link href="/teacher/assignments">Assignments</Link>} title={a.title}
        subtitle={<>{a.classes?.name} · {a.due_at ? `due ${formatDateTime(a.due_at)}` : "no due date"} · {a.points_possible} pts{a.rubrics && ` · rubric: ${a.rubrics.title}`}</>}
        actions={<>
          <Select aria-label="Assignment status" className="w-40" value={a.status} onChange={(e) => setStatus(e.target.value)}><option value="draft">Draft</option><option value="published">Published</option><option value="closed">Closed</option></Select>
          <Button onClick={async () => { try { const n = await rpc<number>("release_grades", { p_assignment: a.id }); toast(`Released ${n} grade(s)`, "success"); router.refresh(); } catch (e) { toast(errorText(e), "error"); } }}>Release all grades</Button>
        </>} />
      {a.instructions && <Card><RichText text={a.instructions} /></Card>}

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-3">
          <Card title={`Submissions (${latest.size}/${roster.length})`} pad={false}>
            <ul className="max-h-[60vh] divide-y divide-ink-100 overflow-y-auto">
              {submissions.map((s) => {
                const g = one(s.grades);
                return (
                  <li key={s.id}><button onClick={() => setSel(s.id)} className={`w-full px-4 py-2 text-left text-sm ${sel === s.id ? "bg-brand-50" : "hover:bg-ink-50"}`}>
                    <p className="font-medium">{s.users?.full_name} <span className="text-xs text-ink-500">#{s.attempt_no}</span></p>
                    <p className="flex flex-wrap gap-1 text-xs">{s.is_late && <Badge tone="amber">late</Badge>}{g ? <Badge tone={g.released_at ? "green" : "brand"}>{Number(g.score)} {g.released_at ? "released" : "draft"}</Badge> : <Badge>ungraded</Badge>}</p>
                  </button></li>
                );
              })}
            </ul>
          </Card>
          {missing.length > 0 && <Card title={`Not submitted (${missing.length})`}><ul className="text-sm text-ink-600">{missing.map((m) => <li key={m.user_id}>{m.users?.full_name}</li>)}</ul></Card>}
        </div>
        {current ? <GradePanel key={current.id} a={a} s={current} onSaved={() => router.refresh()} /> : <Alert>No submissions yet.</Alert>}
      </div>
    </div>
  );
}

function GradePanel({ a, s, onSaved }: { a: Assignment; s: Sub; onSaved: () => void }) {
  const toast = useToast();
  const g = one(s.grades);
  const criteria = a.rubrics?.criteria ?? [];
  const [rubric, setRubric] = useState<Record<string, number>>(g?.rubric_scores ?? {});
  const rubricTotal = Object.values(rubric).reduce((x, y) => x + Number(y), 0);
  const rubricMax = criteria.reduce((x, c) => x + Math.max(0, ...c.levels.map((l) => l.points)), 0);
  const [score, setScore] = useState<number>(g ? Number(g.score) : s.quiz_attempts?.max_score ? Math.round((100 * Number(s.quiz_attempts.score ?? 0)) / Number(s.quiz_attempts.max_score)) * a.points_possible / 100 : 0);
  const [feedback, setFeedback] = useState(g?.feedback ?? "");
  const [release, setRelease] = useState(!!g?.released_at);
  const [busy, setBusy] = useState(false);

  async function save(ret = false) {
    setBusy(true);
    try { await rpc("grade_submission", { p_submission: s.id, p_score: score, p_rubric_scores: rubric, p_feedback: feedback, p_release: release, p_return: ret }); toast("Grade saved", "success"); onSaved(); }
    catch (e) { toast(errorText(e), "error"); }
    setBusy(false);
  }

  return (
    <Card title={`${s.users?.full_name} · attempt ${s.attempt_no}`} actions={<span className="text-xs text-ink-500">{formatDateTime(s.submitted_at)}</span>}>
      <div className="space-y-4">
        {s.quiz_attempts && <Alert>Activity score: {Number(s.quiz_attempts.score ?? 0)} / {Number(s.quiz_attempts.max_score ?? 0)} ({s.quiz_attempts.status}). Answers that need marking are in the <Link href="/teacher/review">review queue</Link>.</Alert>}
        {s.body && <div className="whitespace-pre-wrap rounded-lg bg-ink-50 p-3 text-sm">{s.body}</div>}
        {s.files?.length > 0 && <div className="space-y-1">{s.files.map((f) => (
          <button key={f.path} className="block text-sm font-medium text-brand-700 underline" onClick={async () => {
            const { data } = await createClient().storage.from("submissions").createSignedUrl(f.path, 300);
            if (data?.signedUrl) window.open(data.signedUrl, "_blank", "noopener");
          }}><Icon name="paperclip" className="inline h-3.5 w-3.5 align-[-2px]" /> {f.name}</button>
        ))}</div>}

        {criteria.length > 0 && (
          <div className="space-y-3">
            <p className="label">Rubric: {rubricTotal} / {rubricMax}</p>
            {criteria.map((c) => (
              <div key={c.id}>
                <p className="text-sm font-medium">{c.title}</p>
                <div className="mt-1 flex flex-wrap gap-2">{c.levels.map((l) => (
                  <button key={l.label} type="button" title={l.description} onClick={() => { const next = { ...rubric, [c.id]: l.points }; setRubric(next); const t = Object.values(next).reduce((x, y) => x + Number(y), 0); if (rubricMax) setScore(Math.round((t / rubricMax) * a.points_possible * 10) / 10); }}
                    className={`rounded-lg border px-3 py-1.5 text-xs ${rubric[c.id] === l.points ? "border-brand-500 bg-brand-600 text-white" : "border-ink-200 bg-white"}`}>{l.label} ({l.points})</button>
                ))}</div>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
          <Field label={`Score / ${a.points_possible}`}><Input type="number" min={0} max={a.points_possible} step="0.5" value={score} onChange={(e) => setScore(Number(e.target.value))} /></Field>
          <Field label="Feedback"><Textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} /></Field>
        </div>
        <Toggle checked={release} onChange={setRelease} label="Release to student now" description="Students and linked parents only see released grades." />
        <div className="flex justify-end gap-2">
          {a.max_resubmissions > 0 && <Button variant="secondary" loading={busy} onClick={() => save(true)}>Return for resubmission</Button>}
          <Button loading={busy} onClick={() => save(false)}>Save grade</Button>
        </div>
      </div>
    </Card>
  );
}
