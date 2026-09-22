"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityEditor, ACTIVITY_LABEL, type Activity } from "@/components/activities/ActivityEditor";
import { SlideView, type SlideData } from "@/components/slides/SlideView";
import { Alert, Badge, Button, CopyButton, Field, Modal, Select, Tabs, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useLoader } from "@/lib/hooks";
import { errorText, rpc } from "@/lib/rpc";
import type { ActivityKind, SlideContent, SlideKind } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { SlideForm } from "./SlideForm";

type Lesson = { id: string; tenant_id: string; owner_id: string; title: string; description: string | null; subject: string | null; status: string; is_template: boolean; current_version: number; default_mode: string };
type SlideRow = { id: string; position: number; kind: SlideKind; content: SlideContent; notes: string | null; activity_id: string | null };

export const SLIDE_KINDS: { kind: SlideKind; label: string }[] = [
  { kind: "title", label: "Title" }, { kind: "text", label: "Text" }, { kind: "image", label: "Image" }, { kind: "video", label: "Video (interactive)" },
  { kind: "audio", label: "Audio" }, { kind: "embed", label: "Embed website" }, { kind: "link", label: "Link" }, { kind: "attachment", label: "Attachment" },
  { kind: "shapes", label: "Shapes / diagram" }, { kind: "whiteboard", label: "Whiteboard" }, { kind: "activity", label: "Activity" }
];

export function LessonEditor({ lesson: initial, canEdit, userId, rubrics, classes }: {
  lesson: Lesson; canEdit: boolean; userId: string; rubrics: { id: string; title: string }[]; classes: { id: string; name: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [lesson, setLesson] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<"slide" | "activity">("slide");
  const [addKind, setAddKind] = useState<SlideKind | null>(null);
  const [share, setShare] = useState(false);
  const [versions, setVersions] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty">("saved");
  const timers = useRef<Record<string, number>>({});

  const slides = useLoader(async () => {
    const { data, error } = await createClient().from("lesson_slides").select("id,position,kind,content,notes,activity_id").eq("lesson_id", lesson.id).order("position");
    if (error) throw error;
    return (data ?? []) as SlideRow[];
  }, [lesson.id]);
  const activities = useLoader(async () => {
    const { data } = await createClient().from("activities").select("id,kind,title,instructions,settings,lesson_id,tenant_id,owner_id").eq("lesson_id", lesson.id);
    return Object.fromEntries(((data ?? []) as Activity[]).map((a) => [a.id, a]));
  }, [lesson.id]);

  const [local, setLocalState] = useState<SlideRow[]>([]);
  const latest = useRef<SlideRow[]>([]);
  const setLocal = (next: SlideRow[] | ((prev: SlideRow[]) => SlideRow[])) =>
    setLocalState((prev) => { const v = typeof next === "function" ? next(prev) : next; latest.current = v; return v; });
  useEffect(() => { if (slides.data) setLocal(slides.data); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.data]);
  useEffect(() => { if (!selected && local[0]) setSelected(local[0].id); }, [local, selected]);
  const current = local.find((s) => s.id === selected) ?? null;
  const currentActivity = current?.activity_id ? activities.data?.[current.activity_id] : undefined;

  // Debounced autosave per slide.
  function patchSlide(id: string, patch: Partial<SlideRow>) {
    setLocal((ls) => ls.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    setSaveState("dirty");
    window.clearTimeout(timers.current[id]);
    timers.current[id] = window.setTimeout(async () => {
      setSaveState("saving");
      const s = latest.current.find((x) => x.id === id);
      if (!s) return;
      const { error } = await createClient().from("lesson_slides").update({ content: s.content, notes: s.notes }).eq("id", id);
      setSaveState(error ? "dirty" : "saved");
      if (error) toast(error.message, "error");
    }, 700);
  }

  async function addSlide(kind: SlideKind, activityKind?: ActivityKind) {
    const sb = createClient();
    const position = (current ? current.position : local.length - 1) + 1;
    try {
      // Shift later slides down to make room.
      for (const s of [...local].filter((x) => x.position >= position).sort((a, b) => b.position - a.position)) {
        await sb.from("lesson_slides").update({ position: s.position + 1 }).eq("id", s.id);
      }
      let activityId: string | null = null;
      if (kind === "activity") {
        const { data, error } = await sb.from("activities").insert({
          tenant_id: lesson.tenant_id, lesson_id: lesson.id, owner_id: userId, kind: activityKind ?? "multiple_choice",
          title: ACTIVITY_LABEL[activityKind ?? "multiple_choice"], settings: { show_feedback: "after_submit", attempts_allowed: 1 }
        }).select("id").single();
        if (error) throw new Error(error.message);
        activityId = data.id;
      }
      const { data, error } = await sb.from("lesson_slides").insert({
        tenant_id: lesson.tenant_id, lesson_id: lesson.id, position, kind, content: kind === "text" ? { heading: "New slide", body: "" } : {}, activity_id: activityId
      }).select("id").single();
      if (error) throw new Error(error.message);
      await Promise.all([slides.reload(), activities.reload()]);
      setSelected(data.id);
      setPanel(kind === "activity" ? "activity" : "slide");
    } catch (e) { toast(errorText(e), "error"); }
    setAddKind(null);
  }

  async function move(s: SlideRow, dir: -1 | 1) {
    const other = local.find((x) => x.position === s.position + dir);
    if (!other) return;
    const sb = createClient();
    await sb.from("lesson_slides").update({ position: s.position }).eq("id", other.id);
    await sb.from("lesson_slides").update({ position: other.position }).eq("id", s.id);
    void slides.reload();
  }

  async function remove(s: SlideRow) {
    if (!confirm("Delete this slide?")) return;
    const sb = createClient();
    await sb.from("lesson_slides").delete().eq("id", s.id);
    if (s.activity_id) await sb.from("activities").delete().eq("id", s.activity_id);
    for (const x of local.filter((y) => y.position > s.position).sort((a, b) => a.position - b.position)) {
      await sb.from("lesson_slides").update({ position: x.position - 1 }).eq("id", x.id);
    }
    setSelected(null);
    void slides.reload();
  }

  async function duplicateSlide(s: SlideRow) {
    if (s.kind === "activity") { toast("Duplicate the whole lesson to copy activities.", "info"); return; }
    const sb = createClient();
    for (const x of local.filter((y) => y.position > s.position).sort((a, b) => b.position - a.position)) {
      await sb.from("lesson_slides").update({ position: x.position + 1 }).eq("id", x.id);
    }
    const { data } = await sb.from("lesson_slides").insert({ tenant_id: lesson.tenant_id, lesson_id: lesson.id, position: s.position + 1, kind: s.kind, content: s.content, notes: s.notes }).select("id").single();
    await slides.reload();
    if (data) setSelected(data.id);
  }

  async function saveLesson(patch: Partial<Lesson>) {
    const { data, error } = await createClient().from("lessons").update(patch).eq("id", lesson.id).select("*").single();
    if (error) toast(error.message, "error"); else setLesson(data as Lesson);
  }

  async function publish() {
    try {
      const r = await rpc<{ version: number }>("publish_lesson", { p_lesson: lesson.id });
      setLesson({ ...lesson, status: "published", current_version: r.version });
      toast(`Published version ${r.version}`, "success");
    } catch (e) { toast(errorText(e), "error"); }
  }

  async function duplicate(asTemplate: boolean) {
    try {
      const id = await rpc<string>("duplicate_lesson", { p_lesson: lesson.id, p_as_template: asTemplate, p_title: asTemplate ? `${lesson.title} (template)` : null });
      toast(asTemplate ? "Saved as a template" : "Copy created", "success");
      router.push(`/teacher/lessons/${id}`);
    } catch (e) { toast(errorText(e), "error"); }
  }

  const slideData: SlideData | null = useMemo(() => current ? {
    id: current.id, position: current.position, kind: current.kind, content: current.content,
    activity: currentActivity ? { id: currentActivity.id, kind: currentActivity.kind, title: currentActivity.title, instructions: currentActivity.instructions } : null
  } : null, [current, currentActivity]);

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 bg-white px-4 py-2.5">
        <Link href="/teacher/lessons" className="text-sm">← Lessons</Link>
        <input className="min-w-[12rem] flex-1 rounded-md border border-transparent px-2 py-1 text-lg font-bold hover:border-ink-200 focus:border-brand-500 focus:outline-none"
          value={lesson.title} disabled={!canEdit} aria-label="Lesson title"
          onChange={(e) => setLesson({ ...lesson, title: e.target.value })} onBlur={() => saveLesson({ title: lesson.title })} />
        <Badge tone={lesson.status === "published" ? "green" : "gray"}>{lesson.status}{lesson.current_version ? ` · v${lesson.current_version}` : ""}</Badge>
        {lesson.is_template && <Badge tone="cyan">template</Badge>}
        <span className="text-xs text-ink-400">{saveState === "saving" ? "Saving…" : saveState === "dirty" ? "Unsaved changes" : "All changes saved"}</span>
        <div className="flex flex-wrap gap-2">
          {canEdit ? <>
            <Button size="sm" variant="secondary" onClick={() => setVersions(true)}>Versions</Button>
            <Button size="sm" variant="secondary" onClick={() => duplicate(true)}>Save as template</Button>
            <Button size="sm" variant="secondary" onClick={() => setShare(true)} disabled={lesson.status !== "published"} title={lesson.status !== "published" ? "Publish first" : undefined}>Share link</Button>
            <Button size="sm" onClick={publish}>{lesson.status === "published" ? "Publish update" : "Publish"}</Button>
          </> : <Button size="sm" onClick={() => duplicate(false)}>Make my own copy</Button>}
          <Link href={`/teacher/live/new?lesson=${lesson.id}`} className="btn btn-accent btn-sm no-underline">Teach live</Link>
        </div>
      </div>

      {!canEdit && <div className="px-4 pt-3"><Alert>You're viewing a colleague's published lesson. Make a copy to edit it.</Alert></div>}

      <div className="grid flex-1 lg:grid-cols-[220px_1fr]">
        <aside className="border-r border-ink-200 bg-ink-50 p-3">
          <ol className="space-y-1.5">
            {local.map((s, i) => (
              <li key={s.id}>
                <button onClick={() => { setSelected(s.id); setPanel(s.kind === "activity" ? "activity" : "slide"); }}
                  className={cn("w-full rounded-lg border px-2.5 py-2 text-left text-xs transition", s.id === selected ? "border-brand-400 bg-white shadow-sm" : "border-transparent hover:bg-white")}>
                  <span className="flex items-center justify-between"><span className="font-bold text-ink-400">{i + 1}</span><span className="text-[10px] uppercase text-ink-400">{s.kind}</span></span>
                  <span className="mt-0.5 block truncate font-medium text-ink-800">
                    {s.kind === "activity" ? activities.data?.[s.activity_id ?? ""]?.title ?? "Activity" : s.content.heading || s.content.caption || s.content.url || "Untitled"}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {canEdit && (
            <div className="mt-3">
              <Select value="" onChange={(e) => { const k = e.target.value as SlideKind; if (!k) return; if (k === "activity") setAddKind(k); else void addSlide(k); }}>
                <option value="">+ Add slide…</option>
                {SLIDE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </Select>
            </div>
          )}
        </aside>

        <section className="min-w-0 p-4 sm:p-6">
          {!current || !slideData ? (
            <p className="text-sm text-ink-500">{slides.loading ? "Loading…" : "Add your first slide."}</p>
          ) : (
            <div className="mx-auto max-w-5xl space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {current.kind === "activity" ? (
                  <Tabs value={panel} onChange={setPanel} tabs={[{ id: "activity", label: "Activity & questions" }, { id: "slide", label: "Slide preview" }]} />
                ) : <p className="text-sm font-semibold text-ink-700">Slide {local.indexOf(current) + 1} · {SLIDE_KINDS.find((k) => k.kind === current.kind)?.label}</p>}
                {canEdit && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => move(current, -1)} disabled={current.position === 0} aria-label="Move slide up">↑</Button>
                    <Button size="sm" variant="ghost" onClick={() => move(current, 1)} disabled={current.position === local.length - 1} aria-label="Move slide down">↓</Button>
                    <Button size="sm" variant="ghost" onClick={() => duplicateSlide(current)}>Duplicate</Button>
                    <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => remove(current)}>Delete</Button>
                  </div>
                )}
              </div>

              {current.kind === "activity" && panel === "activity" && currentActivity ? (
                canEdit ? <ActivityEditor key={currentActivity.id} activity={currentActivity} rubrics={rubrics} onChanged={() => void activities.reload()} />
                  : <SlideView slide={slideData} />
              ) : (
                <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
                  <SlideView slide={slideData} />
                  {canEdit && <SlideForm slide={current} lesson={lesson} userId={userId}
                    onChange={(content) => patchSlide(current.id, { content })} onNotes={(notes) => patchSlide(current.id, { notes })} />}
                </div>
              )}
              {current.kind !== "activity" && current.notes !== undefined && !canEdit && current.notes && (
                <Alert title="Teacher notes">{current.notes}</Alert>
              )}
            </div>
          )}
        </section>
      </div>

      <Modal open={addKind === "activity"} onClose={() => setAddKind(null)} title="Add an activity" wide>
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(ACTIVITY_LABEL) as ActivityKind[]).map((k) => (
            <button key={k} className="rounded-lg border border-ink-200 px-4 py-3 text-left hover:border-brand-400 hover:bg-brand-50" onClick={() => addSlide("activity", k)}>
              <span className="font-medium">{ACTIVITY_LABEL[k]}</span>
            </button>
          ))}
        </div>
      </Modal>
      {share && <ShareModal lessonId={lesson.id} classes={classes} onClose={() => setShare(false)} />}
      {versions && <VersionsModal lessonId={lesson.id} onClose={() => setVersions(false)} />}
    </div>
  );
}

function ShareModal({ lessonId, classes, onClose }: { lessonId: string; classes: { id: string; name: string }[]; onClose: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState("student_paced");
  const [hours, setHours] = useState(168);
  const [cls, setCls] = useState("");
  const [created, setCreated] = useState<{ code: string; expires_at: string } | null>(null);
  const shares = useLoader(async () => {
    const { data } = await createClient().from("lesson_shares").select("id,code,mode,expires_at,revoked_at,class_id").eq("lesson_id", lessonId).order("created_at", { ascending: false });
    return data ?? [];
  }, [lessonId, created?.code]);
  const link = (code: string) => `${window.location.origin}/student/lesson/${code}`;

  return (
    <Modal open onClose={onClose} title="Share by secure link" wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Mode"><Select value={mode} onChange={(e) => setMode(e.target.value)}><option value="student_paced">Student-paced</option><option value="front_of_class">Front of class (view only)</option></Select></Field>
          <Field label="Expires after"><Select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            <option value={24}>1 day</option><option value={168}>1 week</option><option value={720}>30 days</option><option value={2160}>90 days</option>
          </Select></Field>
          <Field label="Limit to class"><Select value={cls} onChange={(e) => setCls(e.target.value)}><option value="">Anyone in my school</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
        </div>
        <Button onClick={async () => {
          try { setCreated(await rpc("create_lesson_share", { p_lesson: lessonId, p_mode: mode, p_hours: hours, p_class: cls || null })); }
          catch (e) { toast(errorText(e), "error"); }
        }}>Create link</Button>
        {created && <Alert tone="success" title={`Code ${created.code}`}><div className="flex flex-wrap items-center gap-2"><span className="break-all font-mono text-xs">{link(created.code)}</span><CopyButton value={link(created.code)} /></div></Alert>}
        <table className="table">
          <thead><tr><th>Code</th><th>Mode</th><th>Expires</th><th></th></tr></thead>
          <tbody>{(shares.data ?? []).map((s) => (
            <tr key={s.id}><td className="font-mono">{s.code}</td><td>{s.mode.replace("_", " ")}</td>
              <td>{s.revoked_at ? <Badge tone="red">revoked</Badge> : new Date(s.expires_at) < new Date() ? <Badge>expired</Badge> : formatDateTime(s.expires_at)}</td>
              <td className="text-right">{!s.revoked_at && <Button size="sm" variant="ghost" onClick={async () => { await createClient().from("lesson_shares").update({ revoked_at: new Date().toISOString() }).eq("id", s.id); void shares.reload(); }}>Revoke</Button>}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </Modal>
  );
}

function VersionsModal({ lessonId, onClose }: { lessonId: string; onClose: () => void }) {
  const versions = useLoader(async () => {
    const { data } = await createClient().from("lesson_versions").select("version,created_at,snapshot").eq("lesson_id", lessonId).order("version", { ascending: false });
    return (data ?? []) as unknown as { version: number; created_at: string; snapshot: { slides: unknown[] } }[];
  }, [lessonId]);
  return (
    <Modal open onClose={onClose} title="Published versions">
      {!(versions.data ?? []).length ? <p className="text-sm text-ink-500">Not published yet. Every publish saves an immutable snapshot. Live sessions record which version was taught.</p> : (
        <ul className="divide-y divide-ink-100">{(versions.data ?? []).map((v) => (
          <li key={v.version} className="flex items-center justify-between py-2 text-sm"><span className="font-semibold">Version {v.version}</span>
            <span className="text-ink-500">{v.snapshot.slides?.length ?? 0} slides · {formatDateTime(v.created_at)}</span></li>
        ))}</ul>
      )}
    </Modal>
  );
}
