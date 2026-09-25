"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, Field, Input, Select, Toggle } from "@/components/ui";
import { Icon, type IconName } from "@/components/Icon";
import { cn } from "@/lib/utils";
import { errorText, rpc } from "@/lib/rpc";
import type { GameSettings } from "@/lib/types";

// Game styles. Kahoot-style speed races suit some lessons, but reward fast guessing and
// stress careful thinkers, so "Think it through" (no timer, no speed points) is the default.
const STYLES: { id: string; name: string; icon: IconName; text: string; set: Partial<GameSettings> }[] = [
  { id: "think", name: "Think it through", icon: "idea", text: "No timer and no speed points. Accuracy wins, and you move on when the class is ready.",
    set: { question_seconds: 0, speed_bonus: false, streak_bonus: true, rank_visibility: "end_only", class_goal: false } },
  { id: "together", name: "Class goal", icon: "together", text: "Everyone works towards one target together. No rankings, so nobody is left at the bottom.",
    set: { question_seconds: 0, speed_bonus: false, streak_bonus: false, rank_visibility: "hidden", class_goal: true, goal_percent: 70 } },
  { id: "race", name: "Quick-fire race", icon: "zap", text: "20 seconds a question with speed and streak bonuses. Best for revision the class already knows well.",
    set: { question_seconds: 20, speed_bonus: true, streak_bonus: true, rank_visibility: "after_each", class_goal: false } }
];

type Act = { id: string; title: string; kind: string; lessons: { title: string } | null; questions: { count: number }[] };

export function NewGameForm({ classes, activities, defaults }: { classes: { id: string; name: string }[]; activities: Act[]; defaults: { classId?: string; activityId?: string; sessionId?: string } }) {
  const router = useRouter();
  const [cls, setCls] = useState(defaults.classId ?? classes[0]?.id ?? "");
  const [act, setAct] = useState(defaults.activityId ?? activities[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [style, setStyle] = useState("think");
  const [set, setSet] = useState<GameSettings>({
    question_seconds: 0, speed_bonus: false, streak_bonus: true, rank_visibility: "end_only", display_mode: "first_name_initial",
    team_mode: false, team_count: 2, shuffle_questions: false, shuffle_options: true, podium_size: 3, certificates: true,
    class_goal: false, goal_percent: 70
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const patch = (p: Partial<GameSettings>) => setSet({ ...set, ...p });

  if (!classes.length) return <Alert>Create a class first.</Alert>;
  if (!activities.length) return <Alert>Create a quiz or multiple-choice activity in a <Link href="/teacher/lessons">lesson</Link> first.</Alert>;

  return (
    <Card>
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Class"><Select value={cls} onChange={(e) => setCls(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Questions from"><Select value={act} onChange={(e) => setAct(e.target.value)}>
            {activities.map((a) => <option key={a.id} value={a.id}>{a.title}{a.lessons ? ` (${a.lessons.title})` : ""}, {a.questions[0]?.count ?? 0} questions</option>)}
          </Select></Field>
          <Field label="Game title (optional)" className="sm:col-span-2"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        </div>

        <fieldset>
          <legend className="label mb-2">Game style</legend>
          <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Game style">
            {STYLES.map((st) => (
              <button key={st.id} type="button" role="radio" aria-checked={style === st.id}
                onClick={() => { setStyle(st.id); patch(st.set); }}
                className={cn("rounded-xl border p-4 text-left transition-colors",
                  style === st.id ? "border-ink-900 bg-ink-900 text-white" : "border-ink-200 bg-white hover:border-ink-400")}>
                <span className="flex items-center gap-2 font-display font-bold">
                  <span className={cn("grid h-8 w-8 place-items-center rounded-lg", style === st.id ? "bg-accent-500 text-accent-ink" : "bg-ink-100 text-ink-800")}><Icon name={st.icon} className="h-4 w-4" /></span>
                  {st.name}{st.id === "think" && <span className={cn("ml-auto text-[11px] font-semibold", style === st.id ? "text-accent-400" : "text-ink-500")}>Recommended</span>}
                </span>
                <span className={cn("mt-2 block text-[13px] leading-snug", style === st.id ? "text-ink-300" : "text-ink-600")}>{st.text}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="label mb-2">Scoring</legend>
          <div className="space-y-3">
            <Toggle checked={set.question_seconds === 0} onChange={(v) => patch({ question_seconds: v ? 0 : 20, ...(v ? { speed_bonus: false } : {}) })}
              label="No timer" description="Questions stay open until everyone has answered or you move on. Fairer for careful thinkers and English learners." />
            {set.question_seconds > 0 && <Field label="Seconds per question"><Input type="number" min={5} max={240} value={set.question_seconds} onChange={(e) => patch({ question_seconds: Number(e.target.value) })} /></Field>}
            {set.class_goal && <Field label="Class goal: share of answers correct" hint="The class wins together when it reaches this."><Select value={set.goal_percent} onChange={(e) => patch({ goal_percent: Number(e.target.value) })}>
              {[50, 60, 70, 80, 90].map((n) => <option key={n} value={n}>{n}%</option>)}
            </Select></Field>}
          </div>
          <div className="space-y-3">
            <Toggle checked={set.speed_bonus} disabled={set.question_seconds === 0} onChange={(v) => patch({ speed_bonus: v })} label="Speed bonus" description={set.question_seconds === 0 ? "Needs a timer." : "Up to +50% for fast correct answers. Network lag is not counted against students."} />
            <Toggle checked={set.streak_bonus} onChange={(v) => patch({ streak_bonus: v })} label="Streak bonus" description="+100 per answer in a row (max +500)." />
          </div>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="label mb-2">Leaderboard & privacy</legend>
          <Field label="Show rankings to students"><Select disabled={set.class_goal} value={set.rank_visibility} onChange={(e) => patch({ rank_visibility: e.target.value as GameSettings["rank_visibility"] })}>
            <option value="after_each">After every question</option><option value="end_only">Only at the end</option><option value="hidden">Never (students see only their own rank)</option>
          </Select></Field>
          <Field label="Names on the leaderboard"><Select value={set.display_mode} onChange={(e) => patch({ display_mode: e.target.value as GameSettings["display_mode"] })}>
            <option value="first_name_initial">First name + last initial</option><option value="nickname">Nicknames (you can rename or remove)</option><option value="anonymous">Anonymous (Player 1, 2…)</option>
          </Select></Field>
          <Field label="Podium size"><Input type="number" min={1} max={10} value={set.podium_size} onChange={(e) => patch({ podium_size: Number(e.target.value) })} /></Field>
          <Toggle checked={set.certificates} onChange={(v) => patch({ certificates: v })} label="Badges & certificates" description="Podium, perfect score, streak and speed badges." />
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="label mb-2">Format</legend>
          <div className="space-y-3">
            <Toggle checked={set.team_mode} onChange={(v) => patch({ team_mode: v })} label="Team mode" description="Players are balanced across teams automatically." />
            {set.team_mode && <Field label="Teams"><Input type="number" min={2} max={6} value={set.team_count} onChange={(e) => patch({ team_count: Number(e.target.value) })} /></Field>}
          </div>
          <div className="space-y-3">
            <Toggle checked={set.shuffle_questions} onChange={(v) => patch({ shuffle_questions: v })} label="Randomise question order" />
            <Toggle checked={set.shuffle_options} onChange={(v) => patch({ shuffle_options: v })} label="Shuffle answer options" />
          </div>
        </fieldset>

        {err && <Alert tone="error">{err}</Alert>}
        <Button size="lg" loading={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            const g = await rpc<{ id: string }>("create_game", { p_class: cls, p_activity: act, p_settings: set, p_session: defaults.sessionId ?? null, p_title: title || null });
            router.push(`/teacher/challenge/${g.id}`);
          } catch (e) { setErr(errorText(e)); setBusy(false); }
        }}>Open lobby</Button>
      </div>
    </Card>
  );
}
