"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Card, Field, Input, Select, Toggle } from "@/components/ui";
import { errorText, rpc } from "@/lib/rpc";
import type { GameSettings } from "@/lib/types";

type Act = { id: string; title: string; kind: string; lessons: { title: string } | null; questions: { count: number }[] };

export function NewGameForm({ classes, activities, defaults }: { classes: { id: string; name: string }[]; activities: Act[]; defaults: { classId?: string; activityId?: string; sessionId?: string } }) {
  const router = useRouter();
  const [cls, setCls] = useState(defaults.classId ?? classes[0]?.id ?? "");
  const [act, setAct] = useState(defaults.activityId ?? activities[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [set, setSet] = useState<GameSettings>({
    question_seconds: 20, speed_bonus: true, streak_bonus: true, rank_visibility: "after_each", display_mode: "first_name_initial",
    team_mode: false, team_count: 2, shuffle_questions: false, shuffle_options: true, podium_size: 3, certificates: true
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

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="label mb-2">Scoring</legend>
          <Field label="Seconds per question"><Input type="number" min={5} max={240} value={set.question_seconds} onChange={(e) => patch({ question_seconds: Number(e.target.value) })} /></Field>
          <div className="space-y-3">
            <Toggle checked={set.speed_bonus} onChange={(v) => patch({ speed_bonus: v })} label="Speed bonus" description="Up to +50% for fast correct answers. Network lag is not counted against students." />
            <Toggle checked={set.streak_bonus} onChange={(v) => patch({ streak_bonus: v })} label="Streak bonus" description="+100 per answer in a row (max +500)." />
          </div>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="label mb-2">Leaderboard & privacy</legend>
          <Field label="Show rankings to students"><Select value={set.rank_visibility} onChange={(e) => patch({ rank_visibility: e.target.value as GameSettings["rank_visibility"] })}>
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
