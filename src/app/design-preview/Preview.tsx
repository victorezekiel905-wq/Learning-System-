"use client";
import { AnswerBars, AnswerResult, AnswerTiles, StreakChip } from "@/components/game/LiveGame";
import { GlyphField, Podium } from "@/components/game/Celebrate";
import { Leaderboard } from "@/components/live/Leaderboard";
import { EndScreen, Lobby } from "@/components/live/StudentPhases";
import { Critter } from "@/components/live/Critter";
import { AVATARS } from "@/components/live/avatars";
import type { SessionState } from "@/components/live/types";
import { ControlBar } from "@/app/(app)/teacher/live/[id]/ControlBar";
import { ImportQuestions } from "@/components/activities/ImportQuestions";
import { StartGuide } from "@/app/(app)/teacher/StartGuide";
import { WordCloud } from "@/components/game/WordCloud";
import { TeamStandings } from "@/components/game/Teams";
import { DiagramInput } from "@/components/activities/Diagram";
import { QuestionEditor, blankQuestion, type EditableQuestion } from "@/components/activities/QuestionEditor";
import { useState } from "react";
import { HomeworkBoard } from "@/app/(app)/teacher/homework/HomeworkBoard";
import { HomeworkList } from "@/app/(app)/student/HomeworkList";
import { LibraryGrid } from "@/app/(app)/teacher/lessons/LibraryGrid";
import { ProgressView, type Progress } from "@/components/progress/ProgressDashboard";
import { ProjectedScreen, ScreenStrip } from "@/app/present/[id]/PresentScreens";
import { StartLearning } from "@/components/live/StartLearning";
import { buildDeck, tidyOutline, type ThemeKey } from "@/slides/ai-deck";
import { CanvasFrame } from "@/components/slides/CanvasView";
import { downloadPptx } from "@/lib/pptx-export";

const LEAF_PHOTO = { url: "https://images.unsplash.com/photo-1501004318641-b39e6451bec6?w=1080", alt: "Green leaves in sunlight", credit: "Ada Obi", credit_url: "https://unsplash.com", download_location: "" };
const OUTLINE = tidyOutline({ title: "Photosynthesis", slides: [
  { layout: "title", heading: "Photosynthesis", subheading: "How green plants make their own food", image_query: "leaf" },
  { layout: "objectives", heading: "In this lesson we will", points: ["Say what plants need to make food", "Name the parts of a leaf that help", "Explain why plants matter to us"] },
  { layout: "picture", heading: "Leaves are food factories", points: ["Chlorophyll makes leaves green", "It traps energy from sunlight", "Tiny holes let air in"], image_query: "leaf" },
  { layout: "compare", heading: "Day and night", left_heading: "In the day", left_points: ["Plants make food", "They give out oxygen"], right_heading: "At night", right_points: ["No food is made", "Plants still breathe"] },
  { layout: "key_fact", heading: "Plants turn light into food", subheading: "Carbon dioxide + water + light → glucose + oxygen" },
  { layout: "question", heading: "Why do plants under a tree grow slowly?", subheading: "Think about light." },
  { layout: "points", heading: "What plants need", points: ["Sunlight", "Water from the soil", "Carbon dioxide from the air"] }
] }, 8);
function DeckPreview({ theme }: { theme: ThemeKey }) {
  const deck = buildDeck(OUTLINE, OUTLINE.slides.map((x) => (x.image_query ? LEAF_PHOTO : undefined)), theme);
  return (
    <div className="space-y-3">
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => void downloadPptx("Photosynthesis", deck.map((d) => ({ kind: "canvas", content: d.content, notes: d.notes })))}>Download {theme} as PowerPoint</button>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{deck.map((d, i) => <CanvasFrame key={i} content={d.content} className="rounded-lg border border-ink-200" />)}</div>
    </div>
  );
}
import { SlideView, type SlideData } from "@/components/slides/SlideView";
import type { Screen } from "@/components/live/ScreenRail";

/** A pretend laptop screen, in a colour of its own. */
const fakeScreen = (hue: number, text: string) => "data:image/svg+xml," + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="hsl(${hue} 30% 96%)"/><rect width="640" height="36" fill="hsl(${hue} 45% 40%)"/><text x="24" y="120" font-family="sans-serif" font-size="34" font-weight="700" fill="#1f2937">${text}</text><rect x="24" y="160" width="380" height="18" rx="9" fill="hsl(${hue} 40% 70%)"/><rect x="24" y="196" width="300" height="18" rx="9" fill="hsl(${hue} 40% 80%)"/><rect x="24" y="250" width="160" height="60" rx="12" fill="hsl(${hue} 60% 55%)"/></svg>`);
const PEOPLE: [string, string, "lesson" | "share" | "phone" | "left", boolean?][] = [["Ada Obi", "a", "lesson"], ["Tobi Bello", "b", "lesson", true], ["Kemi Eze", "c", "share"], ["Femi Ade", "d", "left"],
  ["Zara Musa", "e", "lesson"], ["Gift Ola", "f", "phone"], ["Uche Nwosu", "g", "lesson"], ["Bisi Kalu", "h", "lesson"]];
const PRESENT_SLIDES: SlideData[] = [
  { id: "s0", position: 0, kind: "title", content: { heading: "Equivalent fractions", body: "Same amount, different numbers." } },
  { id: "s1", position: 1, kind: "text", content: { heading: "Halves, quarters, eighths", body: "1/2 = 2/4 = 4/8. Multiply the top and the bottom by the same number." } },
  { id: "s2", position: 2, kind: "activity", content: {}, activity: { id: "q", kind: "quiz", title: "Check" } }
];
function presentState(question: boolean): SessionState {
  const st = bar("active", "none");
  st.session.guest_monitoring = true;
  st.session.current_slide = question ? 2 : 1;
  if (question) st.activity = { activity: { id: "q", title: "Check", kind: "quiz" }, attempts: 5, submitted: 3, answered: 3, joined: 7, revealed: false, answered_ids: ["a", "e", "g"],
    questions: [{ question_id: "q1", prompt: "Which is the same as 3/4?", kind: "mcq", points: 1, responses: 3, correct: 2, avg_elapsed_ms: null,
      options: [{ id: "o1", label: "6/8", is_correct: true, count: 2 }, { id: "o2", label: "3/8", is_correct: false, count: 1 }, { id: "o3", label: "4/3", is_correct: false, count: 0 }, { id: "o4", label: "1/4", is_correct: false, count: 0 }] }] } as SessionState["activity"];
  st.roster = PEOPLE.map(([name, id, how, hand]) => ({
    student_id: id, name, presence: how === "left" ? "offline" : "online", last_seen_at: null, current_slide: null, device: null, open_alerts: 0, hand_raised: !!hand, guest: how === "phone",
    web: { sharing: how === "share", unsupported: how === "phone", surface: "monitor", visible: id !== "h", fullscreen: true, away_since: how === "left" ? new Date().toISOString() : null, away_reason: how === "left" ? "Closed the lesson" : null }
  }));
  return st;
}
const PRESENT_SCREENS: Record<string, Screen> = { c: { student_id: "c", device_id: null, image: fakeScreen(100, "Kemi: 3/4 = 6/8"), captured_at: new Date().toISOString(), url: null, stale: false, source: "web" } };
/** Just enough of the classroom guard for the Start learning screen. */
const FAKE_GUARD = { needShare: true, sharing: false, locked: false, needFullscreen: false, fullscreen: false, shareError: null,
  startShare: async () => false, enterFullscreen: async () => {} } as unknown as Parameters<typeof StartLearning>[0]["guard"];
function PresentPreview({ start = null, question = false }: { start?: string | null; question?: boolean }) {
  const [shown, setShown] = useState<string | null>(start);
  const st = presentState(question);
  const cur = PRESENT_SLIDES[st.session.current_slide];
  return (
    <div className="flex min-h-[600px] flex-col bg-ink-900 text-white lg:flex-row">
      <main className="relative flex min-w-0 flex-1 items-center justify-center p-4 sm:p-6">
        {shown ? <ProjectedScreen state={st} sessionId="s" studentId={shown} screens={PRESENT_SCREENS} slides={PRESENT_SLIDES} slide={st.session.current_slide} onBack={() => setShown(null)}
          lesson={<SlideView slide={cur} />} lessonLabel={`Lesson · slide ${st.session.current_slide + 1} of 3`} />
          : <div className="w-full max-w-6xl text-ink-900"><SlideView slide={cur} /></div>}
      </main>
      <ScreenStrip state={st} screens={PRESENT_SCREENS} slides={PRESENT_SLIDES} slide={st.session.current_slide} shown={shown} onShow={(id) => setShown(shown === id ? null : id)} onHide={() => {}} />
    </div>
  );
}

const PROGRESS: Progress = {
  student: { id: "s1", name: "Ada Obi" }, period: "term", date: "2026-10-10", today: "2026-10-10", needs_terms: false, terms: [],
  from: "2026-09-08", to: "2026-12-12", label: "First term 2026/2027", unit: "week", prev_date: "2026-09-07", next_date: null,
  summary: { held: 24, attended: 22, answers: 186, correct: 130, accuracy: 70, points: 48210, prev_held: 20, prev_attended: 18, prev_answers: 150, prev_accuracy: 64 },
  trend: [{ start: "2026-09-08", answers: 30, accuracy: 62, held: 4, attended: 4 }, { start: "2026-09-15", answers: 41, accuracy: 68, held: 5, attended: 5 }, { start: "2026-09-22", answers: 52, accuracy: 74, held: 5, attended: 4 }],
  subjects: [{ subject: "Mathematics", held: 12, attended: 11, answers: 98, accuracy: 64, prev_accuracy: 58, topics: [{ topic: "Decimals", answers: 30, accuracy: 39 }, { topic: "Fractions", answers: 40, accuracy: 87 }] },
             { subject: "Basic Science", held: 12, attended: 11, answers: 88, accuracy: 79, prev_accuracy: 74, topics: [{ topic: "Light", answers: 44, accuracy: 67 }] }],
  strengths: [{ subject: "Mathematics", topic: "Fractions", answers: 40, accuracy: 87 }], needs_help: [{ subject: "Mathematics", topic: "Decimals", answers: 30, accuracy: 39 }],
  lessons: [{ session_id: "x1", title: "Place value", subject: "Mathematics", started_at: "2026-10-08T09:00:00Z", attended: true, points: 4860, answers: 5, accuracy: 80 },
            { session_id: "x2", title: "Light: where it comes from", subject: "Basic Science", started_at: "2026-10-07T09:00:00Z", attended: false, points: 0, answers: 0, accuracy: null }]
};
function ProgressPreview() {
  const [period, setPeriod] = useState<"day" | "week" | "month" | "term" | "year">("term");
  return <ProgressView p={{ ...PROGRESS, period }} viewer="parent" period={period} date={null} onPeriod={setPeriod} onDate={() => {}} />;
}

const WORDS = [["sunlight", 9], ["chlorophyll", 7], ["food", 5], ["green", 4], ["oxygen", 4], ["leaves", 3], ["energy", 3], ["glucose", 2], ["water", 2], ["carbon dioxide", 2], ["plants", 1], ["light", 1]]
  .map(([word, count]) => ({ word: word as string, count: count as number }));
const LEAF = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240"><rect width="400" height="240" fill="#f6f5f1"/><path d="M60 200 C 80 60, 300 20, 350 60 C 330 160, 180 220, 60 200 Z" fill="#7cc36a" stroke="#2f6b2a" stroke-width="4"/><path d="M60 200 L 330 70" stroke="#2f6b2a" stroke-width="3"/><circle cx="210" cy="150" r="10" fill="#f6f5f1" stroke="#2f6b2a" stroke-width="3"/></svg>');
const DIAGRAM = { image_url: LEAF, spots: [{ id: "s1", x: 52, y: 62 }, { id: "s2", x: 70, y: 38 }], labels: [{ id: "a", label: "Stoma" }, { id: "b", label: "Vein (xylem and phloem)" }, { id: "c", label: "Root hair" }] };

/** A control room state in one phase, with or without an open question. */
function bar(phase: "lobby" | "active" | "paused", question: "open" | "revealed" | "none"): SessionState {
  const activity = question === "none" ? null : { activity: { id: "q", title: "Check", kind: "quiz" }, revealed: question === "revealed", answered: 17, joined: 24, questions: [] };
  return {
    session: { id: "s", title: "Equivalent fractions", status: "live", mode: "live_participation", join_code: "482913", class_id: "c", lesson_id: "l",
      current_slide: 3, active_activity_id: null, environment_id: null, environment_active: false, group_chat_enabled: false, responses_visible: false,
      class_name: "Year 8 Mathematics", lesson_title: "Fractions", environment_name: null, tenant_id: "t", started_at: "", lockdown: true, phase, show_leaderboard: false },
    ranking: [{ user_id: "a", name: "Ada", avatar: "fox", score: 4860, rank: 1, streak: 3 }],
    settings: { monitoring_enabled: true, allow_spotlight: true, allow_group_chat: false, allow_screen_capture: true, thumbnail_interval_seconds: 10 },
    server_now: new Date().toISOString(), roster: Array.from({ length: 26 }, () => ({}) as SessionState["roster"][number]), alerts: [], hands: [], commands: [], spotlight: null,
    activity: activity as SessionState["activity"],
    timer: question === "open" ? { activity_id: "q", started_at: new Date().toISOString(), seconds: 20, ends_at: new Date(Date.now() + 14_000).toISOString() } : null
  };
}
const PLAYERS = [["Tobi B.", "panda"], ["Kemi E.", "owl"], ["Femi A.", "lion"], ["Zara M.", "frog"], ["Uche N.", "tiger"], ["Bisi K.", "rabbit"], ["Dayo P.", null], ["Ife O.", "penguin"]]
  .map(([name, avatar]) => ({ name, avatar, me: false }));

const OPTIONS = [{ id: "a", label: "The Moon" }, { id: "b", label: "The Sun" }, { id: "c", label: "A mirror" }, { id: "d", label: "A window" }];
const BOARD = [
  { name: "Ada O.", avatar: "fox", score: 4860, rank: 1 }, { name: "Tobi B.", avatar: "panda", score: 4410, rank: 2 },
  { name: "Kemi E.", avatar: "owl", score: 3990, rank: 3 }, { name: "Femi A.", avatar: "lion", score: 3720, rank: 4, delta: 2 },
  { name: "Zara M.", avatar: "frog", score: 3105, rank: 5, delta: -1 }
];

/** Example game screens (see page.tsx). Sections are anchored so screenshots can target one. */
export function Preview() {
  return (
    <div className="space-y-0">
      <section id="phone" className="mx-auto max-w-md space-y-5 bg-ink-50 p-5">
        <p className="text-[13px] font-semibold text-ink-600">Basic Science · Question 3 of 8</p>
        <div className="rounded-2xl bg-white p-4 text-xl font-bold text-ink-900 shadow-sm">Which of these gives out its own light?</div>
        <AnswerTiles options={OPTIONS} picked={["b"]} onPick={() => {}} />
        <div className="flex gap-2"><StreakChip streak={2} /><StreakChip streak={4} /></div>
      </section>

      <section id="results" className="mx-auto grid max-w-3xl gap-5 bg-ink-50 p-5 sm:grid-cols-2">
        <AnswerResult correct points={1280} extras="fast +280 · streak +100" streak={3} />
        <AnswerResult correct={false} answer={{ label: "The Sun", index: 1 }} explanation="The Sun makes its own light; the Moon reflects it." />
      </section>

      <section id="projector" className="relative overflow-hidden bg-ink-900 p-10 text-white">
        <h2 className="font-display text-5xl font-extrabold">Which of these gives out its own light?</h2>
        <AnswerTiles className="mt-8" options={OPTIONS} big />
        <div className="mt-12"><AnswerBars options={OPTIONS} counts={{ a: 4, b: 19, c: 2, d: 1 }} correct={["b"]} /></div>
      </section>

      <section id="podium" className="relative overflow-hidden bg-ink-900 px-6 py-12 text-white">
        <GlyphField opacity={0.35} />
        <h2 className="relative mb-10 text-center font-display text-6xl font-extrabold">Leaderboard</h2>
        <div className="relative"><Podium entries={BOARD.slice(0, 3)} /></div>
        <div className="relative mx-auto mt-8 max-w-2xl"><Leaderboard entries={BOARD.slice(3)} size="lg" /></div>
      </section>

      <section id="progress" className="bg-ink-50 p-5"><ProgressPreview /></section>
      <section id="hwteacher" className="bg-ink-50 p-5"><HomeworkBoard classes={[{ id: "c1", name: "JSS 1 Gold" }]} lessons={[{ id: "l1", title: "Place value", mine: true }]}
        rows={[{ id: "h1", title: "Place value", class: "JSS 1 Gold", class_id: "c1", due_at: "2026-10-14T17:00:00Z", open: true, students: 32, started: 21, finished: 14 },
               { id: "h2", title: "Equivalent fractions", class: "JSS 1 Gold", class_id: "c1", due_at: "2026-10-03T17:00:00Z", open: false, students: 32, started: 30, finished: 27 }]} /></section>
      <section id="hwstudent" className="bg-ink-50 p-5"><HomeworkList now={Date.parse("2026-10-13T20:00:00Z")} items={[
        { id: "h1", title: "Place value", class: "JSS 1 Gold", due_at: "2026-10-14T17:00:00Z", open: true, questions: 5, answered: 2, started: true },
        { id: "h3", title: "States of matter", class: "Basic Science", due_at: "2026-10-18T17:00:00Z", open: true, questions: 5, answered: 0, started: false },
        { id: "h2", title: "Equivalent fractions", class: "JSS 1 Gold", due_at: "2026-10-03T17:00:00Z", open: false, questions: 5, answered: 5, started: true }]} /></section>
      <section id="library" className="bg-ink-50 p-5"><LibraryGrid items={[
        { id: "a", title: "Light: where it comes from", subject: "Basic Science", level: "JSS 1", description: "Luminous and non-luminous objects, light travelling in straight lines, shadows.", slides: 4, questions: 5, uses: 12 },
        { id: "b", title: "Simple interest", subject: "Mathematics", level: "SS 1", description: "The formula I = PRT ÷ 100, the amount at the end, and finding the time.", slides: 4, questions: 5, uses: 0 },
        { id: "c", title: "Parts of speech", subject: "English", level: "JSS 2", description: "Nouns, verbs, adjectives and adverbs.", slides: 4, questions: 5, uses: 3 }]} /></section>

      <section id="cloud" className="bg-ink-900 px-6 py-12 text-white"><h2 className="mb-8 text-center font-display text-4xl font-extrabold">One word for photosynthesis?</h2><WordCloud words={WORDS} dark big /></section>
      <section id="diagram" className="mx-auto max-w-xl bg-ink-50 p-5"><p className="mb-3 text-lg font-bold">Label the leaf</p><DiagramInput config={DIAGRAM} placements={{ s1: "a" }} onChange={() => {}} /></section>
      <section id="teams" className="bg-ink-900 p-8 text-white"><TeamStandings big teams={[
        { team: 2, name: "Team Star", score: 18240, members: 7, mine: false }, { team: 1, name: "Team Bolt", score: 16110, members: 7, mine: true },
        { team: 3, name: "Team Hexagon", score: 12800, members: 6, mine: false }]} /></section>

      <section id="guide" className="bg-ink-50 p-5"><StartGuide done={{ classes: true, lessons: false, taught: false, report: false }} /></section>

      <section id="aideck" className="space-y-6 bg-ink-50 p-5">{(["swift", "ocean", "sunrise"] as const).map((t) => <DeckPreview key={t} theme={t} />)}</section>
      <section id="startlearning" className="relative h-[640px] [transform:translateZ(0)]"><StartLearning guard={FAKE_GUARD} teacher="Mrs Okafor" title="Equivalent fractions" /></section>
      <section id="present"><PresentPreview /></section>
      <section id="present-question"><PresentPreview question /></section>
      <section id="present-shown"><PresentPreview start="a" question /></section>

      <section id="control" className="space-y-px bg-ink-200">
        {([["lobby", "none"], ["active", "open"], ["active", "revealed"], ["paused", "none"]] as const).map(([ph, q]) => (
          <ControlBar key={ph + q} state={bar(ph, q)} sessionId="s" joined={24} timer={bar(ph, q).timer ?? null} skew={0} monitoring onControl={() => {}} onLockdown={() => {}} onEnd={() => {}} />
        ))}
      </section>

      <section id="critters" className="grid grid-cols-4 gap-4 bg-ink-950 p-6 sm:grid-cols-7">
        {[...Object.keys(AVATARS), null].map((k) => (
          <figure key={k ?? "default"} className="flex flex-col items-center gap-2 rounded-2xl bg-white/10 p-3 text-white">
            <Critter name={k} className="h-16 w-16" /><figcaption className="text-xs">{k ? AVATARS[k] : "No pick yet"}</figcaption>
          </figure>
        ))}
      </section>

      <section id="lobby"><Lobby sessionId="preview" title="Equivalent fractions" teacher="Mrs. Nwosu" name="Ada" avatar="fox" participants={23} code="482913" onAvatar={() => {}} players={PLAYERS} /></section>
      <section id="end"><EndScreen name="Ada" avatar="fox" guest summary={{ answered: 8, correct: 7 }} score={{ score: 4860, rank: 1, of: 26 }} /></section>
    </div>
  );
}

/** The Import questions window, as a quiz activity opens it. */
export function ImportPreview() {
  return <ImportQuestions allowed={["mcq", "multi_select", "true_false", "fill_blank", "matching", "short"]} startAt={0} onClose={() => {}} onImport={async () => {}} />;
}

/** The question editor on a "Label the diagram" question, to try placing spots. */
export function EditorPreview() {
  const [q, setQ] = useState<EditableQuestion>(() => ({ ...blankQuestion("label_diagram"), prompt: "Label the leaf", config: { image_url: LEAF, spots: [], labels: [] } }));
  return <div className="mx-auto max-w-2xl p-5"><QuestionEditor value={q} onChange={setQ} onSave={() => {}} saving={false} /></div>;
}
