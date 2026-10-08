"use client";
import Link from "next/link";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Alert, Card, Select, Spinner } from "@/components/ui";
import { useRpc } from "@/lib/hooks";
import { cn, plural } from "@/lib/utils";

type Period = "week" | "month" | "term" | "year";
type Topic = { topic: string; answers: number; accuracy: number | null; pupils: number; struggling: number };
type Data = {
  period: Period; needs_terms: boolean; label?: string; prev_date?: string; next_date?: string | null;
  classes?: { id: string; name: string }[];
  summary?: { pupils: number; active: number; answers: number; accuracy: number | null };
  subjects?: { subject: string; answers: number; accuracy: number | null; pupils: number; topics: Topic[] }[];
  hardest?: (Topic & { subject: string })[];
  pupils_needing_help?: { student_id: string; name: string; answers: number; accuracy: number; classes: string[]; weakest: { subject: string; topic: string; accuracy: number } | null }[];
  feedback?: { total: number; unanswered: number };
};

const tone = (p: number | null) => (p === null ? "bg-ink-200" : p < 50 ? "bg-rose-500" : "bg-ink-800");
const Meter = ({ v, className }: { v: number | null; className?: string }) => (
  <span className={cn("block h-2 overflow-hidden rounded-full bg-ink-100", className)} aria-hidden>
    <span className={cn("block h-full rounded-full", tone(v))} style={{ width: `${v ?? 0}%` }} />
  </span>
);

export function SchoolProgress() {
  const [period, setPeriod] = useState<Period>("term");
  const [date, setDate] = useState<string | null>(null);
  const [cls, setCls] = useState("");
  const r = useRpc<Data>("school_progress", { p_period: period, p_date: date, p_class: cls || null }, [period, date, cls]);
  const d = r.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Period" className="inline-flex rounded-xl border border-ink-200 bg-white p-1">
            {(["week", "month", "term", "year"] as Period[]).map((p) => (
              <button key={p} type="button" role="tab" aria-selected={period === p} onClick={() => { setPeriod(p); setDate(null); }}
                className={cn("rounded-lg px-3 py-1.5 text-sm font-semibold capitalize", period === p ? "bg-ink-900 text-white" : "text-ink-700 hover:bg-ink-100")}>{p}</button>
            ))}
          </div>
          <Select className="!w-auto" value={cls} onChange={(e) => setCls(e.target.value)} aria-label="Class">
            <option value="">Whole school</option>{(d?.classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Earlier" disabled={!d?.prev_date} onClick={() => d?.prev_date && setDate(d.prev_date)}><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-[11rem] text-center text-sm font-semibold">{d?.label ?? "…"}</span>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Later" disabled={!d?.next_date} onClick={() => d?.next_date && setDate(d.next_date)}><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      {r.error && <Alert tone="error">{r.error}</Alert>}
      {!d && !r.error && <div className="flex justify-center py-16"><Spinner /></div>}
      {d?.needs_terms && <Alert title="Term dates aren't set">Add them in <Link href="/admin/settings#terms">Settings</Link> to see progress by term.</Alert>}

      {d?.summary && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Pupils taking part" value={`${d.summary.active} of ${d.summary.pupils}`} />
            <Stat label="Right answers" value={d.summary.accuracy === null ? "–" : `${d.summary.accuracy}%`} />
            <Stat label="Questions answered" value={d.summary.answers.toLocaleString()} />
            <Stat label="Parent feedback" value={d.feedback?.total ?? 0}
              sub={d.feedback?.unanswered ? <Link href="/teacher/feedback">{d.feedback.unanswered} waiting for a reply</Link> : undefined} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Hardest topics">
              {(d.hardest ?? []).length === 0 ? <p className="text-sm text-ink-500">No topic below 60% (with at least 5 answers) in this period.</p> : (
                <ul className="space-y-3">{d.hardest!.map((t) => (
                  <li key={`${t.subject}|${t.topic}`} className="grid grid-cols-[minmax(0,1fr)_6rem_2.75rem] items-center gap-3 text-sm">
                    <span className="min-w-0"><span className="font-semibold text-ink-900">{t.topic}</span> <span className="text-ink-500">· {t.subject}</span>
                      <span className="block text-[12px] text-ink-500">{plural(t.struggling, "pupil")} below 50% · {plural(t.pupils, "pupil")} answered</span></span>
                    <Meter v={t.accuracy} /><span className="text-right font-semibold tabular-nums">{t.accuracy}%</span>
                  </li>
                ))}</ul>
              )}
            </Card>
            <Card title="Pupils who need help" pad={false}>
              {(d.pupils_needing_help ?? []).length === 0 ? <p className="p-5 text-sm text-ink-500">No pupil below 50% (with at least 5 answers) in this period.</p> : (
                <ul className="max-h-96 divide-y divide-ink-100 overflow-y-auto">{d.pupils_needing_help!.map((p) => (
                  <li key={p.student_id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                    <span className="min-w-0"><Link href={`/teacher/students/${p.student_id}`} className="font-semibold">{p.name}</Link>
                      <span className="block truncate text-[12px] text-ink-500">{p.classes.join(", ")}{p.weakest ? ` · weakest: ${p.weakest.topic} (${p.weakest.subject}) ${p.weakest.accuracy}%` : ""}</span></span>
                    <span className="font-semibold tabular-nums text-rose-700">{p.accuracy}%</span>
                  </li>
                ))}</ul>
              )}
            </Card>
          </div>

          <section className="space-y-3">
            <h2 className="font-display text-lg font-bold text-ink-900">Subjects</h2>
            {(d.subjects ?? []).length === 0 ? <Card><p className="text-sm text-ink-500">No answers in this period.</p></Card> : (
              <div className="grid gap-4 md:grid-cols-2">
                {d.subjects!.map((s) => (
                  <Card key={s.subject}>
                    <div className="flex items-start justify-between gap-3">
                      <div><h3 className="font-display text-base font-bold text-ink-900">{s.subject}</h3>
                        <p className="text-[13px] text-ink-600">{plural(s.pupils, "pupil")} · {plural(s.answers, "answer")}</p></div>
                      <p className="font-display text-2xl font-extrabold">{s.accuracy === null ? "–" : `${s.accuracy}%`}</p>
                    </div>
                    <Meter v={s.accuracy} className="mt-2" />
                    <ul className="mt-4 space-y-2">{s.topics.slice(0, 8).map((t) => (
                      <li key={t.topic} className="grid grid-cols-[minmax(0,1fr)_5rem_2.5rem] items-center gap-2 text-sm">
                        <span className="truncate" title={t.topic}>{t.topic}{t.struggling > 0 && <span className="ml-1 text-[12px] text-rose-700">({t.struggling} struggling)</span>}</span>
                        <Meter v={t.accuracy} /><span className="text-right tabular-nums">{t.accuracy === null ? "–" : `${t.accuracy}%`}</span>
                      </li>
                    ))}</ul>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-4 sm:p-5">
      <p className="text-[13px] font-medium text-ink-600">{label}</p>
      <p className="mt-1 font-display text-3xl font-extrabold tracking-tight text-ink-900">{value}</p>
      {sub && <p className="mt-1 text-[12px] font-semibold">{sub}</p>}
    </div>
  );
}
