"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download, RefreshCw, Sparkles, X } from "lucide-react";
import { Alert, Button, Field, Input, Select, Textarea, Toggle, useToast } from "@/components/ui";
import { CanvasFrame } from "@/components/slides/CanvasView";
import { createClient } from "@/lib/supabase/client";
import { errorText, must } from "@/lib/rpc";
import { downloadPptx } from "@/lib/pptx-export";
import { THEMES, type DeckSlide, type ThemeKey } from "@/slides/ai-deck";
import { cn } from "@/lib/utils";

const LEVELS = ["Nursery", "Primary 1", "Primary 2", "Primary 3", "Primary 4", "Primary 5", "Primary 6", "JSS 1", "JSS 2", "JSS 3", "SS 1", "SS 2", "SS 3", "University or adults"];
type Deck = { title: string; slides: DeckSlide[]; pictures: boolean };

/** Unsplash asks to be told when its photos are used. */
function reportUsed(slides: DeckSlide[]) {
  const locations = slides.flatMap((s) => (s.photo ? [s.photo.download_location] : []));
  if (locations.length) void fetch("/api/ai/slides/used", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locations }) }).catch(() => {});
}

/**
 * Create slides with AI: the teacher says what the lesson is about; Gemini plans the
 * slides, Unsplash finds photos, and they come back designed in the chosen theme. The
 * teacher checks them, drops any they don't want, then creates a lesson (or adds them
 * to the open one) and/or downloads them as a PowerPoint file.
 */
export function AiSlides({ lesson, onAdded }: {
  /** Add to this lesson instead of creating a new one. */
  lesson?: { id: string; tenant_id: string; title: string; subject: string | null };
  onAdded?: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [topic, setTopic] = useState(lesson?.title ?? "");
  const [level, setLevel] = useState("JSS 1");
  const [subject, setSubject] = useState(lesson?.subject ?? "");
  const [count, setCount] = useState(8);
  const [pictures, setPictures] = useState(true);
  const [theme, setTheme] = useState<ThemeKey>("swift");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<"make" | "save" | "download" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [deck, setDeck] = useState<Deck | null>(null);

  async function make() {
    setBusy("make"); setErr(null);
    try {
      const res = await fetch("/api/ai/slides", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, level, subject, count, pictures, theme, notes }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't make the slides. Try again.");
      setDeck(body as Deck);
    } catch (e) { setErr(errorText(e)); }
    finally { setBusy(null); }
  }

  async function save() {
    if (!deck?.slides.length) return;
    setBusy("save"); setErr(null);
    try {
      const sb = createClient();
      let lessonId = lesson?.id, tenant = lesson?.tenant_id, start = 0;
      if (lessonId) {
        const { count: existing } = await sb.from("lesson_slides").select("id", { count: "exact", head: true }).eq("lesson_id", lessonId);
        start = existing ?? 0;
      } else {
        const { data: { user } } = await sb.auth.getUser();
        const { data: me } = await sb.from("users").select("tenant_id").eq("id", user!.id).maybeSingle();
        if (!me?.tenant_id) throw new Error("Lessons belong to a school. Sign in with a teacher or school admin account.");
        tenant = me.tenant_id;
        const created = must(await sb.from("lessons").insert({ tenant_id: tenant, owner_id: user!.id, title: deck.title, subject: subject.trim() || null }).select("id").single())!;
        lessonId = created.id;
      }
      must(await sb.from("lesson_slides").insert(deck.slides.map((s, i) => ({
        tenant_id: tenant, lesson_id: lessonId, position: start + i, kind: "canvas", content: s.content, notes: s.notes || null
      }))));
      reportUsed(deck.slides);
      if (lesson) { toast(`Added ${deck.slides.length} slides to the end of the lesson.`, "success"); setDeck(null); onAdded?.(); }
      else router.push(`/teacher/lessons/${lessonId}`);
    } catch (e) { setErr(errorText(e)); }
    finally { setBusy(null); }
  }

  async function download() {
    if (!deck?.slides.length) return;
    setBusy("download");
    try {
      await downloadPptx(deck.title, deck.slides.map((s) => ({ kind: "canvas", content: s.content, notes: s.notes })));
      reportUsed(deck.slides);
    } catch (e) { toast(`Couldn't make the file: ${errorText(e)}`, "error"); }
    finally { setBusy(null); }
  }

  if (deck) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">{deck.title}</h2>
            <p className="text-sm text-ink-500">{deck.slides.length} slides. Remove any you don&apos;t want; you can change everything in the editor afterwards.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={() => setDeck(null)}><RefreshCw className="h-4 w-4" aria-hidden /> Start again</Button>
            <Button variant="secondary" loading={busy === "download"} disabled={!!busy || !deck.slides.length} onClick={download}><Download className="h-4 w-4" aria-hidden /> Download PowerPoint</Button>
            <Button loading={busy === "save"} disabled={!!busy || !deck.slides.length} onClick={save}>{lesson ? `Add ${deck.slides.length} slides to this lesson` : "Create the lesson"}</Button>
          </div>
        </div>
        {!deck.pictures && pictures && <Alert tone="info">Photos aren&apos;t set up on this site yet, so these slides have none. Ask your administrator to add an Unsplash key.</Alert>}
        {err && <Alert tone="error">{err}</Alert>}
        <ol className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {deck.slides.map((s, i) => (
            <li key={i} className="card overflow-hidden">
              <div className="relative">
                <CanvasFrame content={s.content} />
                <button type="button" aria-label={`Remove slide ${i + 1}`} title="Remove this slide"
                  onClick={() => setDeck({ ...deck, slides: deck.slides.filter((_, j) => j !== i) })}
                  className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full bg-white/90 text-ink-700 shadow hover:bg-white hover:text-rose-700">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <div className="space-y-1 p-3">
                <p className="text-sm font-semibold"><span className="mr-1 text-ink-500">{i + 1}.</span>{s.heading}</p>
                {s.notes && <details className="text-xs text-ink-600"><summary className="cursor-pointer font-medium text-ink-700">Teacher notes</summary><p className="mt-1 whitespace-pre-line">{s.notes}</p></details>}
              </div>
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void make(); }}>
      <Field label="What is the lesson about?" hint="For example: Photosynthesis, Equivalent fractions, The water cycle.">
        <Input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={200} required placeholder="Topic" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Class"><Select value={level} onChange={(e) => setLevel(e.target.value)}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</Select></Field>
        <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={60} placeholder="Optional" /></Field>
        <Field label="Slides"><Select value={count} onChange={(e) => setCount(Number(e.target.value))}>{[5, 6, 8, 10, 12, 15].map((n) => <option key={n} value={n}>{n} slides</option>)}</Select></Field>
      </div>
      <Field label="Your notes (optional)" hint="Paste your lesson notes or scheme of work, and the slides follow them.">
        <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={30000} />
      </Field>
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-ink-800">Look</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(THEMES) as ThemeKey[]).map((k) => (
            <button key={k} type="button" onClick={() => setTheme(k)} aria-pressed={theme === k}
              className={cn("flex items-center gap-2 rounded-xl border-2 px-3 py-2 text-sm font-semibold", theme === k ? "border-brand-500 bg-brand-50" : "border-ink-200 bg-white hover:border-ink-400")}>
              <span className="flex overflow-hidden rounded" aria-hidden>
                {[THEMES[k].dark, THEMES[k].primary, THEMES[k].accent, THEMES[k].soft].map((c) => <span key={c} className="h-5 w-4" style={{ background: c }} />)}
              </span>
              {THEMES[k].label}
            </button>
          ))}
        </div>
      </fieldset>
      <Toggle checked={pictures} onChange={setPictures} label="Add photos" description="Real photos from Unsplash, with the photographer's name on the slide." />
      {err && <Alert tone="error">{err}</Alert>}
      <Button type="submit" size="lg" loading={busy === "make"} disabled={!topic.trim()}><Sparkles className="h-4 w-4" aria-hidden /> Make the slides</Button>
      {busy === "make" && <p className="text-sm text-ink-600">Planning your slides and finding photos… this takes about half a minute.</p>}
    </form>
  );
}
