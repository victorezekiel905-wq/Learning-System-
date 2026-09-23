"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { errorText, rpc } from "@/lib/rpc";

export function StartSessionForm({ classes, lessons, envs, defaultClass, defaultLesson }: {
  classes: { id: string; name: string; students: number }[]; lessons: { id: string; title: string; status: string }[];
  envs: { id: string; name: string }[]; defaultClass?: string; defaultLesson?: string;
}) {
  const router = useRouter();
  const [cls, setCls] = useState(defaultClass ?? classes[0]?.id ?? "");
  const [lesson, setLesson] = useState(defaultLesson ?? "");
  const [mode, setMode] = useState("live_participation");
  const [env, setEnv] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!classes.length) return (
    <Alert title="Create a class first">
      A live session runs for a class, so students can join with its code.{" "}
      <Link href="/teacher/classes" className="font-semibold">Create a class →</Link>
    </Alert>
  );

  return (
    <Card>
      <div className="space-y-4">
        <Field label="Class"><Select value={cls} onChange={(e) => setCls(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.students} students)</option>)}</Select></Field>
        <Field label="Lesson" hint="Optional: run a session without slides for monitoring, chat and quick activities.">
          <Select value={lesson} onChange={(e) => setLesson(e.target.value)}><option value="">No lesson</option>{lessons.map((l) => <option key={l.id} value={l.id}>{l.title}{l.status !== "published" ? " (draft)" : ""}</option>)}</Select>
        </Field>
        <Field label="Delivery mode">
          <Select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="live_participation">Live participation: students follow your slides</option>
            <option value="student_paced">Student-paced: students move at their own speed</option>
            <option value="front_of_class">Front of class: projector only, students watch</option>
          </Select>
        </Field>
        <Field label="Environment" hint="Allowed/blocked sites for managed browsers. You can change it during the session.">
          <Select value={env} onChange={(e) => setEnv(e.target.value)}><option value="">None (monitor only)</option>{envs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
        </Field>
        <Field label="Session title (optional)"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        {err && <Alert tone="error">{err}</Alert>}
        <Button size="lg" loading={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            const s = await rpc<{ id: string }>("start_session", { p_class: cls, p_lesson: lesson || null, p_mode: mode, p_title: title || null, p_environment: env || null });
            router.push(`/teacher/live/${s.id}`);
          } catch (e) { setErr(errorText(e)); setBusy(false); }
        }}>Go live</Button>
      </div>
    </Card>
  );
}
