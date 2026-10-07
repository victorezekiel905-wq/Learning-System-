"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, Field, Input, Select, Toggle } from "@/components/ui";
import { errorText, rpc } from "@/lib/rpc";

export function StartSessionForm({ classes, lessons, envs, defaultClass, defaultLesson, monitoring = false }: {
  classes: { id: string; name: string; students: number }[]; lessons: { id: string; title: string; status: string }[];
  envs: { id: string; name: string }[]; defaultClass?: string; defaultLesson?: string;
  /** The school's classroom-monitoring add-on (environments, lockdown, guest monitoring). */
  monitoring?: boolean;
}) {
  const router = useRouter();
  const [cls, setCls] = useState(defaultClass ?? classes[0]?.id ?? "");
  // Most teachers go live with the lesson they worked on last (the list is newest first).
  const [lesson, setLesson] = useState(defaultLesson ?? lessons[0]?.id ?? "");
  const [mode, setMode] = useState("live_participation");
  // Game/social blocking on by default: the school's ready-made "Lesson focus" environment.
  const [env, setEnv] = useState(envs.find((e) => e.name.startsWith("Lesson focus"))?.id ?? "");
  const [title, setTitle] = useState("");
  const [monitorGuests, setMonitorGuests] = useState(false);
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
        <Field label="Lesson" hint="Your most recent lesson is picked. Choose &quot;No lesson&quot; to watch screens and run quick activities only.">
          <Select value={lesson} onChange={(e) => setLesson(e.target.value)}>{lessons.map((l) => <option key={l.id} value={l.id}>{l.title}{l.status !== "published" ? " (draft)" : ""}</option>)}<option value="">No lesson: screens, chat and quick activities only</option></Select>
        </Field>
        <Field label="Delivery mode">
          <Select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="live_participation">Live participation: students follow your slides</option>
            <option value="student_paced">Student-paced: students move at their own speed</option>
            <option value="front_of_class">Front of class: projector only, students watch</option>
          </Select>
        </Field>
        {monitoring && <Field label="Environment" hint="&quot;Lesson focus&quot; blocks games and social media on school-managed browsers. On any device, leaving the lesson alerts you instantly. You can change it during the session.">
          <Select value={env} onChange={(e) => setEnv(e.target.value)}><option value="">None (monitor only)</option>{envs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
        </Field>}
        <Field label="Session title (optional)"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="rounded-xl border border-ink-200 bg-ink-50 p-4">
          <p className="text-sm font-semibold text-ink-900">Guests</p>
          <p className="mb-3 mt-0.5 text-[13px] text-ink-600">Anyone with the code can also join at <b>/join</b> by typing a name, with no account. You can stop new guests or remove one during the lesson.</p>
          {monitoring && <Toggle checked={monitorGuests} onChange={setMonitorGuests} label="Monitor guests too"
            description="Lockdown, screen sharing and leave alerts apply to guests. Off: guests just take part." />}
        </div>
        {err && <Alert tone="error">{err}</Alert>}
        <Button size="lg" loading={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            const s = await rpc<{ id: string }>("start_session", { p_class: cls, p_lesson: lesson || null, p_mode: mode, p_title: title || null, p_environment: monitoring ? env || null : null });
            if (monitoring && monitorGuests) await rpc("set_session_guests", { p_session: s.id, p_monitor: true });
            router.push(`/teacher/live/${s.id}`);
          } catch (e) { setErr(errorText(e)); setBusy(false); }
        }}>Go live</Button>
      </div>
    </Card>
  );
}
