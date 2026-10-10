"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Card, Empty, Field, Input, Modal, Select, useToast } from "@/components/ui";
import { errorText, rpc } from "@/lib/rpc";
import { formatDateTime } from "@/lib/utils";

export type HomeworkRow = { id: string; title: string; class: string; class_id: string; due_at: string; open: boolean; students: number; started: number; finished: number };

/** "2026-10-12T18:00" in the teacher's own time zone, for a datetime-local input. */
function localInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function tomorrowAt6() { const d = new Date(Date.now() + 86_400_000); d.setHours(18, 0, 0, 0); return d; }

export function HomeworkBoard({ rows, classes, lessons, initialLesson }: {
  rows: HomeworkRow[]; classes: { id: string; name: string }[]; lessons: { id: string; title: string; mine: boolean }[]; initialLesson?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [cls, setCls] = useState(classes[0]?.id ?? "");
  const [lesson, setLesson] = useState(initialLesson && lessons.some((l) => l.id === initialLesson) ? initialLesson : lessons[0]?.id ?? "");
  const [due, setDue] = useState(() => localInput(tomorrowAt6()));
  const [busy, setBusy] = useState(false);
  const [moving, setMoving] = useState<HomeworkRow | null>(null);
  const [newDue, setNewDue] = useState("");

  async function setHomework() {
    setBusy(true);
    try {
      await rpc("set_homework", { p_class: cls, p_lesson: lesson, p_due: new Date(due).toISOString() });
      toast("Homework set. Your students have been told.", "success");
      router.refresh();
    } catch (e) { toast(errorText(e), "error"); }
    finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <Card title="Set homework">
        {!classes.length ? <p className="text-sm text-ink-600">Homework is set for a class. <Link href="/teacher/classes">Make a class</Link> first.</p>
          : !lessons.length ? <p className="text-sm text-ink-600">Homework is a lesson. <Link href="/teacher/lessons?tab=library">Pick one from the library</Link> or make one first.</p> : (
          <div className="space-y-4">
            <Field label="Class"><Select value={cls} onChange={(e) => setCls(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
            <Field label="Lesson" hint="Students work through its slides and questions at their own pace.">
              <Select value={lesson} onChange={(e) => setLesson(e.target.value)}>
                {lessons.map((l) => <option key={l.id} value={l.id}>{l.title}{l.mine ? "" : " (shared)"}</option>)}
              </Select>
            </Field>
            <Field label="Due" hint="It closes then; answers so far are kept."><Input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            <Button className="w-full" loading={busy} disabled={!cls || !lesson || !due} onClick={() => void setHomework()}>Set homework</Button>
          </div>
        )}
      </Card>

      <div className="min-w-0">
        {!rows.length ? <Empty title="No homework yet">Set a lesson as homework and it appears here, with who has started and finished.</Empty> : (
          <>
          <ul className="space-y-3 sm:hidden">
            {rows.map((r) => (
              <li key={r.id} className="card card-pad">
                <div className="flex items-start justify-between gap-2">
                  <div><p className="font-medium text-ink-900">{r.title}</p><p className="text-xs text-ink-500">{r.class}</p></div>
                  {r.open ? <Badge tone="green">Open</Badge> : <Badge>Closed</Badge>}
                </div>
                <p className="mt-2 text-sm text-ink-700">Due {formatDateTime(r.due_at)}</p>
                <p className="mt-1 text-sm tabular-nums"><b>{r.finished}</b> of {r.students} finished · {r.started} started</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={r.open ? `/teacher/live/${r.id}` : `/teacher/reports?session=${r.id}`} className="btn btn-secondary btn-sm no-underline">{r.open ? "Watch" : "Report"}</Link>
                  {r.open && <Button size="sm" variant="ghost" onClick={() => { setMoving(r); setNewDue(localInput(new Date(r.due_at))); }}>Change due date</Button>}
                </div>
              </li>
            ))}
          </ul>
          <div className="card hidden overflow-hidden sm:block">
            <table className="table">
              <thead><tr><th>Homework</th><th>Due</th><th>Done</th><th /></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}>
                  <td><span className="block font-medium text-ink-900">{r.title}</span><span className="text-xs text-ink-500">{r.class}</span></td>
                  <td className="whitespace-nowrap">{formatDateTime(r.due_at)} {r.open ? <Badge tone="green">Open</Badge> : <Badge>Closed</Badge>}</td>
                  <td className="whitespace-nowrap tabular-nums"><b>{r.finished}</b> of {r.students} finished<span className="block text-xs text-ink-500">{r.started} started</span></td>
                  <td className="whitespace-nowrap text-right">
                    {r.open && <Button size="sm" variant="ghost" onClick={() => { setMoving(r); setNewDue(localInput(new Date(r.due_at))); }}>Change due date</Button>}
                    <Link href={r.open ? `/teacher/live/${r.id}` : `/teacher/reports?session=${r.id}`} className="btn btn-secondary btn-sm no-underline">{r.open ? "Watch" : "Report"}</Link>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          </>
        )}
      </div>

      <Modal open={!!moving} onClose={() => setMoving(null)} title="Change the due date"
        footer={<><Button variant="ghost" onClick={() => setMoving(null)}>Cancel</Button><Button onClick={async () => {
          try { await rpc("set_homework_due", { p_session: moving!.id, p_due: new Date(newDue).toISOString() }); setMoving(null); toast("Due date changed", "success"); router.refresh(); }
          catch (e) { toast(errorText(e), "error"); }
        }}>Save</Button></>}>
        <Field label={moving?.title ?? "Due"}><Input type="datetime-local" value={newDue} onChange={(e) => setNewDue(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}
