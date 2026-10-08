"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Printer } from "lucide-react";
import { Alert, Badge, Card, Spinner } from "@/components/ui";
import { useRpc } from "@/lib/hooks";
import { cn, plural } from "@/lib/utils";

/** public.progress_report (migration 0930). */
export type Progress = {
  student: { id: string; name: string };
  period: Period; date: string; today: string; needs_terms: boolean;
  terms: { id: string; name: string; school_year: string; starts_on: string; ends_on: string }[];
  from?: string; to?: string; label?: string; unit?: "day" | "week" | "month" | null;
  prev_date?: string | null; next_date?: string | null;
  summary?: { held: number; attended: number; answers: number; correct: number; accuracy: number | null; points: number;
    prev_held: number | null; prev_attended: number | null; prev_answers: number | null; prev_accuracy: number | null };
  trend?: { start: string; answers: number; accuracy: number | null; held: number; attended: number }[];
  subjects?: { subject: string; held: number; attended: number; answers: number; accuracy: number | null; prev_accuracy: number | null;
    topics: { topic: string; answers: number; accuracy: number | null }[] }[];
  strengths?: Topic[]; needs_help?: Topic[];
  lessons?: { session_id: string; title: string; subject: string; started_at: string; attended: boolean; points: number; answers: number; accuracy: number | null }[];
};
type Topic = { subject: string; topic: string; answers: number; accuracy: number | null };
export type Period = "day" | "week" | "month" | "term" | "year";

const PERIODS: { id: Period; label: string }[] = [
  { id: "day", label: "Day" }, { id: "week", label: "Week" }, { id: "month", label: "Month" }, { id: "term", label: "Term" }, { id: "year", label: "Year" }
];
const UNIT_WORD = { day: "day", week: "week", month: "month" } as const;

const fmt = (date: string, o: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", ...o });
const tone = (p: number | null) => (p === null ? "bg-ink-300" : p >= 75 ? "bg-emerald-500" : p >= 50 ? "bg-amber-400" : "bg-rose-500");

function Meter({ value, className }: { value: number | null; className?: string }) {
  return (
    <span className={cn("block h-2 overflow-hidden rounded-full bg-ink-100", className)} aria-hidden>
      <span className={cn("block h-full rounded-full", tone(value))} style={{ width: `${value ?? 0}%` }} />
    </span>
  );
}

function Change({ now, before, unit = "", word }: { now: number | null; before: number | null; unit?: string; word: string }) {
  if (now === null || before === null) return null;
  if (now === before) return <span className="text-[12px] text-ink-500">Same as the previous {word}</span>;
  const up = now > before;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-[12px] font-semibold", up ? "text-emerald-700" : "text-rose-700")}>
      {up ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : <ArrowDownRight className="h-3.5 w-3.5" aria-hidden />}
      {up ? "+" : "−"}{Math.abs(now - before)}{unit} on the previous {word}
    </span>
  );
}

function Big({ label, value, children }: { label: string; value: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-4 sm:p-5">
      <p className="text-[13px] font-medium text-ink-600">{label}</p>
      <p className="mt-1 font-display text-3xl font-extrabold tracking-tight text-ink-900">{value}</p>
      <div className="mt-1 min-h-[1.25rem]">{children}</div>
    </div>
  );
}

/**
 * Progress for one student over a day, week, month, term or school year: the same
 * view for the student, their parents and their teachers (wording changes).
 */
export function ProgressDashboard({ studentId, viewer, isAdmin }: { studentId: string; viewer: "student" | "parent" | "staff"; isAdmin?: boolean }) {
  const [period, setPeriod] = useState<Period>("week");
  const [date, setDate] = useState<string | null>(null);
  const r = useRpc<Progress>("progress_report", { p_student: studentId, p_period: period, p_date: date }, [studentId, period, date]);
  return <ProgressView p={r.data} error={r.error} viewer={viewer} isAdmin={isAdmin} period={period} date={date}
    onPeriod={(x) => { setPeriod(x); setDate(null); }} onDate={setDate} />;
}

/** The dashboard itself, drawn from a report. */
export function ProgressView({ p, error, viewer, isAdmin, period, date, onPeriod, onDate }: {
  p: Progress | null | undefined; error?: string | null; viewer: "student" | "parent" | "staff"; isAdmin?: boolean;
  period: Period; date: string | null; onPeriod: (p: Period) => void; onDate: (d: string | null) => void;
}) {
  const setDate = onDate;
  const r = { error };
  const first = p?.student.name.split(" ")[0] ?? "";
  const you = viewer === "student";
  const word = period === "term" ? "term" : period === "year" ? "year" : period;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div role="tablist" aria-label="Period" className="inline-flex rounded-xl border border-ink-200 bg-white p-1">
          {PERIODS.map((x) => (
            <button key={x.id} type="button" role="tab" aria-selected={period === x.id} onClick={() => onPeriod(x.id)}
              className={cn("rounded-lg px-3 py-1.5 text-sm font-semibold", period === x.id ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-ink-100")}>{x.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="btn btn-ghost btn-sm" aria-label={`Previous ${word}`} disabled={!p?.prev_date} onClick={() => p?.prev_date && setDate(p.prev_date)}>
            <ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-[11rem] text-center text-sm font-semibold text-ink-900">{p?.label ?? (p?.needs_terms ? "Terms not set" : "…")}</span>
          <button type="button" className="btn btn-ghost btn-sm" aria-label={`Next ${word}`} disabled={!p?.next_date} onClick={() => p?.next_date && setDate(p.next_date)}>
            <ChevronRight className="h-4 w-4" /></button>
          {date && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDate(null)}>{period === "day" ? "Today" : `This ${word}`}</button>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.print()} aria-label="Print"><Printer className="h-4 w-4" /></button>
        </div>
      </div>

      {r.error && <Alert tone="error">{r.error}</Alert>}
      {!p && !r.error && <div className="flex justify-center py-16"><Spinner /></div>}
      {p?.needs_terms && (
        <Alert title="The school hasn't entered its term dates yet">
          Term reports appear once the school adds them.{isAdmin && <> <Link href="/admin/settings#terms">Add the term dates</Link></>}
        </Alert>
      )}

      {p && p.summary && (
        <>
          <h2 className="hidden font-display text-xl font-bold print:block">Progress: {p.student.name} · {p.label}</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Big label="Lessons attended" value={p.summary.held ? `${p.summary.attended} of ${p.summary.held}` : p.summary.attended}>
              {p.summary.held > p.summary.attended && <span className="text-[12px] font-semibold text-rose-700">Missed {p.summary.held - p.summary.attended}</span>}
            </Big>
            <Big label="Right answers" value={p.summary.accuracy === null ? "–" : `${p.summary.accuracy}%`}>
              <Change now={p.summary.accuracy} before={p.summary.prev_accuracy} unit=" pts" word={word} />
            </Big>
            <Big label="Questions answered" value={p.summary.answers}>
              <Change now={p.summary.answers} before={p.summary.prev_answers} word={word} />
            </Big>
            <Big label="Points earned" value={p.summary.points.toLocaleString()} />
          </div>

          {p.trend && p.trend.length > 0 && <Trend p={p} />}

          <div className="grid gap-4 md:grid-cols-2">
            <Card title={you ? "You're strong in" : `${first} is strong in`}>
              <TopicList items={p.strengths ?? []} good empty={`Topics with 80% or more right (at least 3 questions) show here.`} />
            </Card>
            <Card title={you ? "Practise these" : "Needs more practice"}>
              <TopicList items={p.needs_help ?? []} empty="Topics below 60% right (at least 3 questions) show here. Nothing yet." />
            </Card>
          </div>

          <section className="space-y-3">
            <h3 className="font-display text-lg font-bold text-ink-900">Subjects</h3>
            {(p.subjects ?? []).length === 0 ? <Card><p className="text-sm text-ink-500">No lessons in this {word}.</p></Card> : (
              <div className="grid gap-4 md:grid-cols-2">
                {p.subjects!.map((s) => <SubjectCard key={s.subject} s={s} word={word} />)}
              </div>
            )}
          </section>

          {(p.lessons ?? []).length > 0 && (
            <Card title="Lessons" pad={false}>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Date</th><th>Lesson</th><th>Subject</th><th>Took part</th><th className="text-right">Answered</th><th className="w-36">Right</th><th className="text-right">Points</th></tr></thead>
                  <tbody>{p.lessons!.map((l) => (
                    <tr key={l.session_id}>
                      <td className="whitespace-nowrap">{new Date(l.started_at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</td>
                      <td>{l.title}</td><td className="text-ink-600">{l.subject}</td>
                      <td>{l.attended ? "Yes" : <Badge tone="red">Missed</Badge>}</td>
                      <td className="text-right tabular-nums">{l.attended ? l.answers : ""}</td>
                      <td>{l.accuracy !== null && <span className="flex items-center gap-2"><Meter value={l.accuracy} className="flex-1" /><span className="w-9 text-right tabular-nums">{l.accuracy}%</span></span>}</td>
                      <td className="text-right tabular-nums">{l.attended && l.points ? l.points.toLocaleString() : ""}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Trend({ p }: { p: Progress }) {
  const unit = p.unit ?? "day";
  const label = (d: string) => unit === "day" ? fmt(d, { weekday: "short" }) : unit === "week" ? fmt(d, { day: "numeric", month: "short" }) : fmt(d, { month: "short" });
  const anyAnswers = p.trend!.some((t) => t.answers > 0);
  return (
    <Card title={`Right answers, ${UNIT_WORD[unit]} by ${UNIT_WORD[unit]}`}>
      {!anyAnswers ? <p className="text-sm text-ink-500">No answers yet in this period.</p> : (
        <div className="-mx-1 overflow-x-auto px-1"><div className="flex h-44 min-w-max items-end gap-1.5 sm:min-w-0 sm:gap-2" role="img"
          aria-label={p.trend!.map((t) => `${label(t.start)}: ${t.accuracy === null ? "no answers" : `${t.accuracy}%`}`).join(", ")}>
          {p.trend!.map((t) => (
            <div key={t.start} className="flex w-11 shrink-0 flex-col items-center gap-1 sm:w-auto sm:min-w-0 sm:flex-1" title={`${label(t.start)}: ${t.answers} answered${t.accuracy !== null ? `, ${t.accuracy}% right` : ""}`}>
              <div className="flex h-36 w-full flex-col items-center justify-end gap-1">
                {t.accuracy !== null ? <>
                  <span className="text-[11px] font-semibold tabular-nums text-ink-700">{t.accuracy}%</span>
                  <span className={cn("block w-full max-w-10 rounded-t-md", tone(t.accuracy))} style={{ height: `${Math.max(t.accuracy, 3) * 1.12}px` }} />
                </> : <span className="block h-1 w-full max-w-10 rounded bg-ink-200" />}
              </div>
              <span className="w-full truncate text-center text-[11px] text-ink-500">{label(t.start)}</span>
            </div>
          ))}
        </div></div>
      )}
    </Card>
  );
}

function TopicList({ items, good, empty }: { items: Topic[]; good?: boolean; empty: string }) {
  if (!items.length) return <p className="text-sm text-ink-500">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((t) => (
        <li key={`${t.subject}|${t.topic}`} className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-sm">
          <span className="min-w-0"><span className="font-semibold text-ink-900">{t.topic}</span> <span className="text-ink-500">· {t.subject}</span></span>
          <span className={cn("font-semibold tabular-nums", good ? "text-emerald-700" : "text-rose-700")}>{t.accuracy}%</span>
          <span className="col-span-2 text-[12px] text-ink-500">{plural(t.answers, "question")} answered</span>
        </li>
      ))}
    </ul>
  );
}

function SubjectCard({ s, word }: { s: NonNullable<Progress["subjects"]>[number]; word: string }) {
  const [all, setAll] = useState(false);
  const topics = all ? s.topics : s.topics.slice(0, 5);
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-display text-base font-bold text-ink-900">{s.subject}</h4>
          <p className="text-[13px] text-ink-600">{s.held ? `${s.attended} of ${plural(s.held, "lesson")} attended` : `${plural(s.attended, "lesson")}`} · {plural(s.answers, "answer")}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-2xl font-extrabold text-ink-900">{s.accuracy === null ? "–" : `${s.accuracy}%`}</p>
          <Change now={s.accuracy} before={s.prev_accuracy} unit=" pts" word={word} />
        </div>
      </div>
      <Meter value={s.accuracy} className="mt-2" />
      {s.topics.length > 0 && (
        <ul className="mt-4 space-y-2">
          {topics.map((t) => (
            <li key={t.topic} className="grid grid-cols-[minmax(0,1fr)_5rem_2.5rem] items-center gap-2 text-sm">
              <span className="truncate text-ink-800" title={t.topic}>{t.topic}</span>
              <Meter value={t.accuracy} />
              <span className="text-right tabular-nums text-ink-700">{t.accuracy === null ? "–" : `${t.accuracy}%`}</span>
            </li>
          ))}
        </ul>
      )}
      {s.topics.length > 5 && <button type="button" className="mt-2 text-[13px] font-semibold text-brand-700 print:hidden" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${s.topics.length} topics`}</button>}
    </Card>
  );
}
