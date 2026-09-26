"use client";
import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, Printer } from "lucide-react";
import { ThreadView } from "@/components/chat/ThreadView";
import { Icon } from "@/components/Icon";
import { Alert, Badge, Button, Card, Empty, Modal, Spinner, Tabs, useToast } from "@/components/ui";
import { useRpc } from "@/lib/hooks";
import { BADGE_LABEL } from "@/lib/progress";
import { errorText, rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";

type Stats = {
  sessions_held: number; sessions_attended: number; minutes: number; answers: number; accuracy: number | null; reasoned: number;
  activities_completed: number; hands_raised: number; xp: number; focus_events: number; participation: number | null;
};
type Focus = {
  at: string; kind: string; reason: string; site: string | null; page_title: string | null; returned: boolean; away_minutes: number | null;
  context: { class?: string; lesson?: string; slide?: number; slide_heading?: string; activity?: string } | null;
};
type Subject = {
  class_id: string; class: string; subject: string | null; teacher: string | null; teacher_id: string;
  now: Stats & { focus: Focus[] }; before: Stats;
  trend: { week: string; accuracy: number | null; xp: number; participation: number | null }[];
  assignments: { due: number; submitted: number; late: number; missing: number; missing_titles: string[] };
  grades: { assignment: string; score: number; out_of: number; feedback: string | null; released_at: string }[];
};
export type Report = {
  student: { id: string; name: string }; period: "day" | "week"; from: string; to: string; date: string; timezone: string;
  focus_details: boolean; progress: { xp: number; level: number }; badges: { badge: string; earned_at: string }[]; subjects: Subject[];
};

const KIND: Record<string, string> = {
  environment_left: "Left the lesson", domain_blocked: "Opened a blocked site", off_task: "Possibly off-task", tab_limit: "Too many tabs open"
};

function participationLabel(p: number | null) {
  if (p === null) return { text: "No lessons", tone: "gray" as const };
  if (p >= 75) return { text: "Very engaged", tone: "green" as const };
  if (p >= 50) return { text: "Engaged", tone: "brand" as const };
  if (p >= 25) return { text: "Some participation", tone: "amber" as const };
  return { text: "Low participation", tone: "red" as const };
}

const shift = (date: string, days: number) => {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
};
const fmtDay = (date: string, opts: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", ...opts });
const fmtTime = (iso: string, tz: string) => new Date(iso).toLocaleString(undefined, { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit" });

function Change({ now, before, unit = "" }: { now: number | null; before: number | null; unit?: string }) {
  if (now === null || before === null || now === before) return <span className="inline-flex items-center gap-0.5 text-[12px] text-ink-500"><Minus className="h-3 w-3" aria-hidden />same as before</span>;
  const up = now > before;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[12px] font-semibold", up ? "text-emerald-700" : "text-rose-700")}>
      {up ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />}
      {up ? "+" : "−"}{Math.abs(now - before)}{unit} vs previous
    </span>
  );
}

/**
 * A child's daily or weekly report: every subject, how they took part, how they
 * are progressing, and each time they left a lesson (what they were doing and
 * where they went). Used by parents, and by teachers before a parent meeting.
 */
export function ChildReport({ studentId, viewer, meId, openThread, initialPeriod = "week" }: {
  studentId: string; viewer: "parent" | "staff"; meId: string; openThread?: string | null; initialPeriod?: "day" | "week";
}) {
  const toast = useToast();
  const [period, setPeriod] = useState<"day" | "week">(initialPeriod);
  const [date, setDate] = useState<string | null>(null);
  const [thread, setThread] = useState<{ id: string; title: string } | null>(openThread ? { id: openThread, title: "Message" } : null);
  const report = useRpc<Report>("parent_report", { p_student: studentId, p_period: period, p_date: date }, [studentId, period, date]);
  const r = report.data;
  const today = new Date().toISOString().slice(0, 10);

  async function messageTeacher(s: Subject) {
    try {
      const id = await rpc<string>("open_parent_thread", { p_student: studentId, p_class: s.class_id });
      setThread({ id, title: `${s.teacher ?? "Teacher"} · ${s.class}` });
    } catch (e) { toast(errorText(e), "error"); }
  }

  const label = r && (r.period === "day"
    ? fmtDay(r.date, { weekday: "long", day: "numeric", month: "long" })
    : `Week of ${fmtDay(r.date, { day: "numeric", month: "long" })}`);
  const all = r?.subjects ?? [];
  const sum = (k: keyof Stats) => all.reduce((n, s) => n + Number(s.now[k] ?? 0), 0);
  const scored = all.filter((s) => s.now.participation !== null);
  const avgParticipation = scored.length ? Math.round(scored.reduce((n, s) => n + (s.now.participation ?? 0), 0) / scored.length) : null;
  const graded = all.filter((s) => s.now.accuracy !== null);
  const avgAccuracy = graded.length ? Math.round(graded.reduce((n, s) => n + (s.now.accuracy ?? 0), 0) / graded.length) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 print:hidden">
        <Tabs value={period} onChange={(p) => { setPeriod(p); setDate(null); }} tabs={[{ id: "day", label: "Daily report" }, { id: "week", label: "Weekly report" }]} />
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" aria-label={period === "day" ? "Previous day" : "Previous week"}
            onClick={() => setDate(shift(r?.date ?? today, period === "day" ? -1 : -7))}><Icon name="chevronLeft" className="h-4 w-4" /></Button>
          <span className="min-w-[10rem] text-center text-sm font-semibold">{label ?? "…"}</span>
          <Button size="sm" variant="secondary" aria-label={period === "day" ? "Next day" : "Next week"}
            disabled={!r || shift(r.date, period === "day" ? 1 : 7) > today}
            onClick={() => setDate(shift(r!.date, period === "day" ? 1 : 7))}><Icon name="chevronRight" className="h-4 w-4" /></Button>
          <Button size="sm" variant="ghost" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden />Print</Button>
        </div>
      </div>

      {report.error && !r && <Alert tone="error">{report.error}</Alert>}
      {!r ? <div className="flex items-center gap-2 text-sm text-ink-500"><Spinner />Preparing the report…</div> : (
        <>
          <section className="rounded-2xl bg-ink-950 p-5 text-white sm:p-7" aria-label="Summary">
            <p className="text-[13px] font-semibold text-ink-400">{r.student.name} · {label}</p>
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
              {[
                ["Participation", avgParticipation === null ? "—" : `${avgParticipation}`, participationLabel(avgParticipation).text],
                ["Accuracy", avgAccuracy === null ? "—" : `${avgAccuracy}%`, `${sum("answers")} answers`],
                ["In class", `${sum("minutes")} min`, `${sum("sessions_attended")} of ${sum("sessions_held")} lessons`],
                ["Left a lesson", `${sum("focus_events")}`, sum("focus_events") === 0 ? "Stayed focused" : "See details below"]
              ].map(([k, v, sub]) => (
                <div key={k}>
                  <p className="text-[13px] text-ink-400">{k}</p>
                  <p className={cn("mt-1 font-display text-3xl font-extrabold tracking-tightest", k === "Left a lesson" && v !== "0" ? "text-rose-300" : "text-white")}>{v}</p>
                  <p className="mt-0.5 text-[13px] text-ink-300">{sub}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4 text-[13px] text-ink-300">
              <span className="rounded-md bg-accent-500 px-2 py-0.5 font-bold text-accent-ink">Level {r.progress.level}</span>
              <span>{r.progress.xp} XP in total</span>
              {r.badges.map((b) => <span key={b.badge} className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-0.5 text-white"><Icon name="award" className="h-3.5 w-3.5" />{BADGE_LABEL[b.badge] ?? b.badge}</span>)}
            </div>
          </section>

          {all.length === 0 ? <Empty title="No classes yet" icon={<Icon name="book" />}>When your child joins a class, their report appears here.</Empty> : (
            <div className="grid gap-5 xl:grid-cols-2">
              {all.map((s) => <SubjectCard key={s.class_id} s={s} r={r} viewer={viewer} onMessage={() => messageTeacher(s)} />)}
            </div>
          )}

          <details className="rounded-xl border border-ink-200 bg-white p-4 text-sm text-ink-700">
            <summary className="cursor-pointer font-semibold text-ink-900">How participation is worked out</summary>
            <p className="mt-2">Out of 100: attending lessons (30), answering questions (35; about five answers a lesson is full marks), explaining their reasoning (15),
              asking for help when stuck (5), and staying in the lesson (15; each time they leave takes some off). It shows how actively your child took part,
              not how clever they are.</p>
          </details>
        </>
      )}

      <Modal open={!!thread} onClose={() => setThread(null)} title={thread?.title ?? "Message"}>
        {thread && <ThreadView threadId={thread.id} meId={meId} className="h-[420px]" />}
      </Modal>
    </div>
  );
}

function SubjectCard({ s, r, viewer, onMessage }: { s: Subject; r: Report; viewer: "parent" | "staff"; onMessage: () => void }) {
  const p = participationLabel(s.now.participation);
  const maxXp = Math.max(1, ...s.trend.map((w) => w.xp));
  return (
    <Card title={<span className="flex flex-wrap items-center gap-2">{s.subject ?? s.class}<span className="text-[13px] font-normal text-ink-500">{s.class}{s.teacher && ` · ${s.teacher}`}</span></span>}
      actions={viewer === "parent" && <Button size="sm" variant="secondary" onClick={onMessage}><Icon name="chat" className="h-4 w-4" />Message teacher</Button>}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-ink-500">Participation</p>
            <p className="font-display text-4xl font-extrabold leading-none tracking-tightest">{s.now.participation ?? "—"}<span className="text-lg text-ink-400">{s.now.participation !== null && "/100"}</span></p>
          </div>
          <div className="text-right"><Badge tone={p.tone}>{p.text}</Badge><div className="mt-1"><Change now={s.now.participation} before={s.before.participation} /></div></div>
        </div>
        {s.now.participation !== null && (
          <div className="h-2 overflow-hidden rounded-full bg-ink-100" role="img" aria-label={`Participation ${s.now.participation} out of 100`}>
            <div className="h-full rounded-full bg-brand-600" style={{ width: `${s.now.participation}%` }} />
          </div>
        )}

        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          {[
            ["Lessons", `${s.now.sessions_attended}/${s.now.sessions_held}`],
            ["Time in class", `${s.now.minutes} min`],
            ["Answers", `${s.now.answers}`],
            ["Accuracy", s.now.accuracy === null ? "—" : `${s.now.accuracy}%`],
            ["Explained reasoning", `${s.now.reasoned}`],
            ["Asked for help", `${s.now.hands_raised}`],
            ["Activities done", `${s.now.activities_completed}`],
            ["XP earned", `${s.now.xp}`]
          ].map(([k, v]) => (
            <div key={k} className="rounded-xl bg-ink-50 px-3 py-2"><dt className="text-[12px] text-ink-500">{k}</dt><dd className="font-display text-lg font-bold tabular-nums">{v}</dd></div>
          ))}
        </dl>

        <div>
          <p className="mb-2 text-[13px] font-semibold text-ink-600">Learning progress, last 6 weeks</p>
          <ol className="grid h-24 grid-cols-6 items-end gap-2" aria-label="Weekly XP and accuracy">
            {s.trend.map((w) => (
              <li key={w.week} className="flex h-full flex-col items-center justify-end gap-1" title={`Week of ${w.week}: ${w.xp} XP, accuracy ${w.accuracy ?? "—"}%`}>
                <span className="text-[11px] font-semibold tabular-nums text-ink-600">{w.accuracy === null ? "" : `${w.accuracy}%`}</span>
                <span className="w-full rounded-t-md bg-accent-500" style={{ height: `${Math.max(4, (w.xp / maxXp) * 60)}px` }} />
                <span className="text-[10px] text-ink-500">{fmtDay(w.week, { day: "numeric", month: "short" })}</span>
              </li>
            ))}
          </ol>
          <p className="mt-1 text-[12px] text-ink-500">Bars: XP earned each week. Numbers: accuracy.</p>
        </div>

        {(s.assignments.due > 0 || s.grades.length > 0) && (
          <div className="space-y-2">
            {s.assignments.due > 0 && (
              <p className="text-sm">
                <span className="font-semibold">Homework due:</span> {s.assignments.submitted} of {s.assignments.due} handed in
                {s.assignments.late > 0 && `, ${s.assignments.late} late`}
                {s.assignments.missing > 0 && <span className="font-semibold text-rose-700">, missing: {s.assignments.missing_titles.join(", ")}</span>}
              </p>
            )}
            {s.grades.map((g, i) => (
              <div key={i} className="rounded-xl border border-ink-200 px-3 py-2 text-sm">
                <p className="flex justify-between gap-2 font-semibold"><span>{g.assignment}</span><span className="tabular-nums">{Number(g.score)}/{Number(g.out_of)}</span></p>
                {g.feedback && <p className="mt-0.5 text-ink-600">{g.feedback}</p>}
              </div>
            ))}
          </div>
        )}

        <div>
          <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink-600">
            Focus <Badge tone={s.now.focus_events ? "red" : "green"}>{s.now.focus_events ? `Left ${s.now.focus_events}×` : "Stayed in every lesson"}</Badge>
          </p>
          {s.now.focus_events > 0 && !r.focus_details && <p className="text-sm text-ink-600">Your school shares how often, not the details. Ask the teacher if you'd like to know more.</p>}
          {s.now.focus.length > 0 && (
            <ol className="space-y-2">
              {s.now.focus.map((f, i) => {
                const doing = [f.context?.lesson && `“${f.context.lesson}”`, f.context?.slide && `slide ${f.context.slide}${f.context.slide_heading ? ` (${f.context.slide_heading})` : ""}`,
                               f.context?.activity && `activity “${f.context.activity}”`].filter(Boolean).join(", ");
                const where = f.page_title || f.site;
                return (
                  <li key={i} className="rounded-xl border border-rose-200 bg-rose-50/60 px-3 py-2.5 text-sm">
                    <p className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-rose-900">{KIND[f.kind] ?? f.kind}</span>
                      <span className="text-[12px] text-ink-600">{fmtTime(f.at, r.timezone)}</span>
                    </p>
                    {doing && <p className="mt-1 text-ink-700"><span className="font-medium">Was working on:</span> {doing}</p>}
                    <p className="text-ink-700"><span className="font-medium">{where ? "Went to:" : "What happened:"}</span> {where ? `${f.page_title ?? ""}${f.page_title && f.site ? ` (${f.site})` : f.site ?? ""}` : f.reason}</p>
                    <p className="text-[12px] text-ink-600">{f.returned ? `Came back after about ${f.away_minutes ?? 1} min` : "Did not return before the lesson ended"}</p>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </Card>
  );
}
