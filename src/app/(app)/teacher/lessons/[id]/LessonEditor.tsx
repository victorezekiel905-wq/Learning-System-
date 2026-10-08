"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityEditor, ACTIVITY_LABEL, type Activity } from "@/components/activities/ActivityEditor";
import { SlideView, type SlideData } from "@/components/slides/SlideView";
import { CanvasEditor } from "@/components/slides/CanvasEditor";
import { CanvasFrame } from "@/components/slides/CanvasView";
import { useSignedUrl } from "@/lib/media";
import { CONVERTIBLE, LAYOUTS, toCanvas, type CanvasContent } from "@/slides/canvas";
import { MEDIA_KINDS, SLIDE_TYPES, slideLabel } from "@/slides/registry";
import { Alert, Badge, Button, CopyButton, Field, Modal, Select, Tabs, useToast, useDialog } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useLoader } from "@/lib/hooks";
import { ActionError, errorText, must, rpc } from "@/lib/rpc";
import { messageForError } from "@/lib/errors";
import type { ActivityKind, SlideContent, SlideKind } from "@/lib/types";
import { cn, formatDateTime } from "@/lib/utils";
import { SlideForm } from "./SlideForm";

type Lesson = { id: string; tenant_id: string; owner_id: string; title: string; description: string | null; subject: string | null; status: string; is_template: boolean; current_version: number; default_mode: string };
type SlideRow = { id: string; position: number; kind: SlideKind; content: SlideContent; notes: string | null; activity_id: string | null };

const ACTIVITY_HELP: Record<ActivityKind, string> = {
  multiple_choice: "Pick the right answer, with instant feedback.",
  poll: "Quick opinions or checks, no right answer. Results live.",
  open_ended: "Students write a response; share the best ones.",
  quiz: "Several questions of any type, scored.",
  draw: "Students draw or annotate on a picture.",
  fill_blank: "Type the missing words.",
  matching: "Match pairs, such as terms and definitions.",
  drag_drop: "Put things in order or sort them into groups.",
  collab_board: "Everyone posts notes to one shared board.",
  file_upload: "Students hand in a photo or file.",
  short_answer: "A short written answer, marked with a rubric.",
  code: "Write and run code."
};

export function LessonEditor({ lesson: initial, canEdit, userId, rubrics, classes }: {
  lesson: Lesson; canEdit: boolean; userId: string; rubrics: { id: string; title: string }[]; classes: { id: string; name: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const dialog = useDialog();
  const [lesson, setLesson] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [panel, setPanel] = useState<"slide" | "activity">("slide");
  const [addKind, setAddKind] = useState<SlideKind | null>(null);
  const [share, setShare] = useState(false);
  const [versions, setVersions] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "dirty">("saved");
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
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
  useEffect(() => { if (slides.data) setLocal(slides.data);
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

  /** Slide ids in their current order. */
  const ordered = () => [...local].sort((a, b) => a.position - b.position).map((x) => x.id);

  /** Saves a new slide order in one atomic call (migration 0810). */
  async function saveOrder(ids: string[]) {
    const sb = createClient();
    const { error } = await sb.rpc("reorder_slides", { p_lesson: lesson.id, p_order: ids });
    if (!error) return;
    // Database not updated to 0810 yet: renumber one slide at a time, stopping at the first failure.
    if (error.code !== "PGRST202") throw new ActionError(messageForError(error), error.code);
    for (const [i, id] of ids.entries()) must(await sb.from("lesson_slides").update({ position: i }).eq("id", id));
  }

  async function addSlide(kind: SlideKind, activityKind?: ActivityKind, design?: CanvasContent) {
    const sb = createClient();
    // New slides go straight after the selected one (or at the end).
    const at = current ? ordered().indexOf(current.id) + 1 : local.length;
    try {
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
        tenant_id: lesson.tenant_id, lesson_id: lesson.id, position: local.length, kind, content: design ?? (kind === "text" ? { heading: "New slide", body: "" } : {}), activity_id: activityId
      }).select("id").single();
      if (error) throw new Error(error.message);
      const ids = ordered();
      ids.splice(at, 0, data.id);
      await saveOrder(ids);
      await Promise.all([slides.reload(), activities.reload()]);
      setSelected(data.id);
      setPanel(kind === "activity" ? "activity" : "slide");
    } catch (e) { toast(errorText(e), "error"); }
    setAddKind(null);
  }

  async function move(s: SlideRow, dir: -1 | 1) {
    const ids = ordered();
    const i = ids.indexOf(s.id), j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    try { await saveOrder(ids); } catch (e) { toast(errorText(e), "error"); }
    void slides.reload();
  }

  /** Drag-and-drop in the slide list: puts the dragged slide where it was dropped. */
  async function moveTo(id: string, index: number) {
    const ids = ordered().filter((x) => x !== id);
    ids.splice(Math.min(index, ids.length), 0, id);
    setLocal((ls) => ls.map((s) => ({ ...s, position: ids.indexOf(s.id) })).sort((a, b) => a.position - b.position));
    try { await saveOrder(ids); } catch (e) { toast(errorText(e), "error"); }
    void slides.reload();
  }

  /** Title, text and picture slides (including imported pages) become designed slides. */
  async function designIt(s: SlideRow) {
    const content = toCanvas(s.kind, s.content);
    try {
      must(await createClient().from("lesson_slides").update({ kind: "canvas", content }).eq("id", s.id));
      setLocal((ls) => ls.map((x) => (x.id === s.id ? { ...x, kind: "canvas", content } : x)));
    } catch (e) { toast(errorText(e), "error"); }
  }

  async function remove(s: SlideRow) {
    if (!(await dialog.confirm({ title: "Delete this slide?", tone: "danger", confirmLabel: "Delete slide" }))) return;
    const sb = createClient();
    try {
      must(await sb.from("lesson_slides").delete().eq("id", s.id));
      if (s.activity_id) must(await sb.from("activities").delete().eq("id", s.activity_id));
      await saveOrder(ordered().filter((id) => id !== s.id));
      setSelected(null);
    } catch (e) { toast(errorText(e), "error"); }
    void slides.reload();
  }

  async function duplicateSlide(s: SlideRow) {
    if (s.kind === "activity") { toast("Duplicate the whole lesson to copy activities.", "info"); return; }
    const sb = createClient();
    try {
      const data = must(await sb.from("lesson_slides").insert({ tenant_id: lesson.tenant_id, lesson_id: lesson.id, position: local.length, kind: s.kind, content: s.content, notes: s.notes }).select("id").single())!;
      const ids = ordered();
      ids.splice(ids.indexOf(s.id) + 1, 0, data.id);
      await saveOrder(ids);
      await slides.reload();
      setSelected(data.id);
    } catch (e) { toast(errorText(e), "error"); }
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

  // Derived from state inside the memo, so the preview only changes when the slide does.
  const activityMap = activities.data;
  const slideData: SlideData | null = useMemo(() => {
    const c = local.find((sl) => sl.id === selected);
    if (!c) return null;
    const a = c.activity_id ? activityMap?.[c.activity_id] : undefined;
    return { id: c.id, position: c.position, kind: c.kind, content: c.content,
             activity: a ? { id: a.id, kind: a.kind, title: a.title, instructions: a.instructions } : null };
  }, [local, selected, activityMap]);

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] lg:min-h-[calc(100dvh-4rem)] flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-ink-200 bg-white px-4 py-2.5">
        <Link href="/teacher/lessons" className="text-sm">← Lessons</Link>
        <input className="min-w-[12rem] flex-1 rounded-md border border-transparent px-2 py-1 text-lg font-bold hover:border-ink-200 focus:border-brand-500 focus:outline-none"
          value={lesson.title} disabled={!canEdit} aria-label="Lesson title"
          onChange={(e) => setLesson({ ...lesson, title: e.target.value })} onBlur={() => saveLesson({ title: lesson.title })} />
        <Badge tone={lesson.status === "published" ? "green" : "gray"}>{lesson.status}{lesson.current_version ? ` · v${lesson.current_version}` : ""}</Badge>
        {lesson.is_template && <Badge tone="cyan">template</Badge>}
        <span className="text-xs text-ink-500">{saveState === "saving" ? "Saving…" : saveState === "dirty" ? "Unsaved changes" : "All changes saved"}</span>
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

      <div className="grid flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="border-r border-ink-200 bg-ink-50 p-3 lg:max-h-[calc(100dvh-7.5rem)] lg:overflow-y-auto">
          <ol className="flex gap-3 overflow-x-auto pb-1 lg:block lg:space-y-3 lg:overflow-visible lg:pb-0" aria-label="Slides">
            {local.map((s, i) => (
              <li key={s.id} className={cn("relative w-40 shrink-0 lg:w-auto", dropAt === i && dragging !== s.id && "before:absolute before:-top-2 before:inset-x-0 before:h-1 before:rounded-full before:bg-brand-500")}
                draggable={canEdit} onDragStart={(e) => { setDragging(s.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", s.id); }}
                onDragOver={(e) => { if (!dragging) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDropAt(e.clientY > r.top + r.height / 2 ? i + 1 : i); }}
                onDrop={(e) => { e.preventDefault(); if (dragging && dropAt !== null) void moveTo(dragging, dropAt > ordered().indexOf(dragging) ? dropAt - 1 : dropAt); setDragging(null); setDropAt(null); }}
                onDragEnd={() => { setDragging(null); setDropAt(null); }}>
                <button onClick={() => { setSelected(s.id); setPanel(s.kind === "activity" ? "activity" : "slide"); }}
                  className={cn("flex w-full gap-2 text-left", dragging === s.id && "opacity-40")}>
                  <span className="w-5 shrink-0 pt-0.5 text-right text-[11px] font-bold text-ink-500">{i + 1}</span>
                  <span className={cn("block min-w-0 flex-1 overflow-hidden rounded-lg border-2 bg-white transition", s.id === selected ? "border-brand-500 shadow-sm" : "border-ink-200 hover:border-ink-400")}>
                    <SlideThumb slide={s} title={s.kind === "activity" ? activities.data?.[s.activity_id ?? ""]?.title ?? "Activity" : s.content.heading || s.content.caption || s.content.url || slideLabel(s.kind)} />
                  </span>
                </button>
              </li>
            ))}
            {dragging && <li className="hidden h-6 lg:block" onDragOver={(e) => { e.preventDefault(); setDropAt(local.length); }}
              onDrop={(e) => { e.preventDefault(); void moveTo(dragging, local.length); setDragging(null); setDropAt(null); }} />}
          </ol>
          {canEdit && (
            <div className="mt-3">
              <Button className="w-full" onClick={() => setAddKind("activity")}>+ Add slide</Button>
            </div>
          )}
        </aside>

        <section className="min-w-0 p-4 sm:p-6">
          {!current || !slideData ? (
            slides.loading ? <p className="text-sm text-ink-500">Loading…</p> : (
              <div className="mx-auto mt-10 max-w-md text-center">
                <p className="font-display text-lg font-bold text-ink-900">This lesson has no slides yet</p>
                <p className="mt-1 text-sm text-ink-600">Add content and activities one by one, or go back and use <b>New lesson → Import file</b> to bring in a whole PDF deck.</p>
                {canEdit && <Button className="mt-4" onClick={() => setAddKind("activity")}>+ Add slide</Button>}
              </div>
            )
          ) : (
            <div className={cn("mx-auto space-y-5", current.kind === "canvas" && canEdit ? "max-w-[1400px]" : "max-w-5xl")}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                {current.kind === "activity" ? (
                  <Tabs value={panel} onChange={setPanel} tabs={[{ id: "activity", label: "Activity & questions" }, { id: "slide", label: "Slide preview" }]} />
                ) : <p className="text-sm font-semibold text-ink-700">Slide {local.indexOf(current) + 1} · {slideLabel(current.kind)}</p>}
                {canEdit && (
                  <div className="flex gap-1">
                    {CONVERTIBLE.includes(current.kind) && (
                      <Button size="sm" variant="secondary" onClick={() => designIt(current)}
                        title="Open this slide in the designer, to add text boxes, pictures and shapes">Design this slide</Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => move(current, -1)} disabled={current.position === 0} aria-label="Move slide up">↑</Button>
                    <Button size="sm" variant="ghost" onClick={() => move(current, 1)} disabled={current.position === local.length - 1} aria-label="Move slide down">↓</Button>
                    <Button size="sm" variant="ghost" onClick={() => duplicateSlide(current)}>Duplicate</Button>
                    <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => remove(current)}>Delete</Button>
                  </div>
                )}
              </div>

              {current.kind === "canvas" && canEdit ? (
                <CanvasEditor key={current.id} content={current.content} notes={current.notes} lesson={lesson} userId={userId}
                  onChange={(content) => patchSlide(current.id, { content })} onNotes={(notes) => patchSlide(current.id, { notes })} />
              ) : current.kind === "activity" && panel === "activity" && currentActivity ? (
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

      <Modal open={addKind === "activity"} onClose={() => setAddKind(null)} title="Add a slide" wide>
        <p className="-mt-1 mb-4 text-sm text-ink-600">It goes straight after the slide you have selected.</p>
        <section aria-labelledby="add-design" className="mb-6">
          <h3 id="add-design" className="mb-2 text-sm font-bold text-ink-900">Slides <span className="font-normal text-ink-500">(design them freely: text, pictures, shapes)</span></h3>
          <LayoutChoices onPick={(content) => { setAddKind(null); void addSlide("canvas", undefined, content); }} />
        </section>
        <div className="grid gap-6 md:grid-cols-2">
          <section aria-labelledby="add-content">
            <h3 id="add-content" className="mb-2 text-sm font-bold text-ink-900">Media and web</h3>
            <div className="grid gap-2">
              {MEDIA_KINDS.map((k) => (
                <button key={k} type="button" onClick={() => { setAddKind(null); void addSlide(k); }}
                  className="rounded-xl border border-ink-200 bg-white px-4 py-3 text-left transition-colors hover:border-ink-900">
                  <span className="block text-sm font-semibold text-ink-900">{SLIDE_TYPES[k].label}</span>
                  <span className="block text-[13px] leading-snug text-ink-600">{SLIDE_TYPES[k].help}</span>
                </button>
              ))}
            </div>
          </section>
          <section aria-labelledby="add-activity">
            <h3 id="add-activity" className="mb-2 text-sm font-bold text-ink-900">Activities <span className="font-normal text-ink-500">(students answer on their devices)</span></h3>
            <div className="grid gap-2">
              {(Object.keys(ACTIVITY_LABEL) as ActivityKind[]).map((k) => (
                <button key={k} type="button" onClick={() => { setAddKind(null); void addSlide("activity", k); }}
                  className="rounded-xl border border-ink-200 bg-white px-4 py-3 text-left transition-colors hover:border-brand-600 hover:bg-brand-50">
                  <span className="block text-sm font-semibold text-ink-900">{ACTIVITY_LABEL[k]}</span>
                  <span className="block text-[13px] leading-snug text-ink-600">{ACTIVITY_HELP[k]}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </Modal>
      {share && <ShareModal lessonId={lesson.id} classes={classes} onClose={() => setShare(false)} />}
      {versions && <VersionsModal lessonId={lesson.id} onClose={() => setVersions(false)} />}
    </div>
  );
}

/** Ready-made layouts for a new designed slide, each shown as a small preview. */
function LayoutChoices({ onPick }: { onPick: (c: CanvasContent) => void }) {
  const layouts = useMemo(() => LAYOUTS.map((l) => ({ ...l, preview: l.make() })), []);
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {layouts.map((l) => (
        <button key={l.key} type="button" title={l.help} onClick={() => onPick(l.make())}
          className="group rounded-xl border border-ink-200 bg-white p-1.5 text-left transition hover:border-brand-500 hover:shadow-sm">
          <CanvasFrame content={l.preview} className="pointer-events-none rounded-lg border border-ink-100" />
          <span className="block px-1 pb-0.5 pt-1.5 text-[13px] font-semibold text-ink-900">{l.label}</span>
        </button>
      ))}
    </div>
  );
}

/** A slide in the slide list: designed slides and pictures in miniature, other kinds as a labelled card. */
function SlideThumb({ slide, title }: { slide: SlideRow; title: string }) {
  const picture = useSignedUrl(slide.kind === "image" ? slide.content.media_path : null);
  if (slide.kind === "canvas") return <CanvasFrame content={slide.content} className="pointer-events-none" />;
  if (slide.kind === "image" && (picture || slide.content.url)) {
    return <span className="block aspect-video bg-ink-900"><img src={picture ?? slide.content.url} alt="" className="h-full w-full object-contain" /></span>;
  }
  const dark = slide.kind === "title";
  return (
    <span className={cn("flex aspect-video flex-col justify-between p-2", dark ? "bg-ink-950 text-white" : slide.kind === "activity" ? "bg-brand-50" : "bg-white")}>
      <span className={cn("text-[10px] font-semibold uppercase tracking-wide", dark ? "text-ink-300" : "text-ink-500")}>{slideLabel(slide.kind)}</span>
      <span className="line-clamp-2 text-xs font-semibold leading-tight">{title}</span>
    </span>
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
              <td className="text-right">{!s.revoked_at && <Button size="sm" variant="ghost" onClick={async () => { must(await createClient().from("lesson_shares").update({ revoked_at: new Date().toISOString() }).eq("id", s.id)); void shares.reload(); }}>Revoke</Button>}</td></tr>
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
