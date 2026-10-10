"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { OptionShape } from "@/components/game/Shape";
import { cn } from "@/lib/utils";

const HIDE_KEY = "sc-start-guide-hidden";

export type GuideProgress = { classes: boolean; lessons: boolean; taught: boolean; report: boolean };

/**
 * For a new teacher: four steps from nothing to a lesson's report, each ticked off by
 * what they have actually done. Gone once all four are done; "Hide" keeps it hidden on
 * this device.
 */
export function StartGuide({ done }: { done: GuideProgress }) {
  const [hidden, setHidden] = useState(true); // until the saved choice is read, so it never flashes
  useEffect(() => {
    let saved = false;
    try { saved = localStorage.getItem(HIDE_KEY) === "1"; } catch { /* private window */ }
    setHidden(saved);
  }, []);
  const steps = [
    { key: "classes", title: "Make a class", text: "Students join it once with its code. Guests can also join a lesson without one.", href: "/teacher/classes", cta: "Make a class" },
    { key: "lessons", title: "Get a lesson ready", text: "Start from the library, bring in a PowerPoint or PDF, or let AI write the questions.", href: "/teacher/lessons?tab=library", cta: "Open the library" },
    { key: "taught", title: "Teach it live", text: "Students go to the join page on any phone and type the code on your screen.", href: "/teacher/live/new", cta: "Start a live lesson" },
    { key: "report", title: "See how it went", text: "Every lesson ends with a report: who took part and the questions the class found hard.", href: "/teacher/reports", cta: "Open reports" }
  ] as const;
  const count = steps.filter((s) => done[s.key]).length;
  if (hidden || count === steps.length) return null;
  const next = steps.find((s) => !done[s.key])!;
  return (
    <section aria-labelledby="start-guide" className="mb-6 rounded-2xl border border-brand-200 bg-white p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="start-guide" className="font-display text-xl font-bold tracking-tight text-ink-900">Your first lesson in four steps</h2>
          <p className="mt-1 text-sm text-ink-600">{count} of {steps.length} done</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setHidden(true); try { localStorage.setItem(HIDE_KEY, "1"); } catch { /* fine */ } }}>
          <X className="h-4 w-4" aria-hidden />Hide
        </button>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-100" aria-hidden><div className="h-full rounded-full bg-tile-bolt transition-all" style={{ width: `${(count / steps.length) * 100}%` }} /></div>
      <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => {
          const ok = done[s.key];
          const current = s.key === next.key;
          return (
            <li key={s.key} className={cn("flex flex-col rounded-xl border p-4", current ? "border-brand-300 bg-brand-50/60" : "border-ink-200")}>
              <span className={cn("grid h-8 w-8 place-items-center rounded-full", ok ? "bg-emerald-700 text-white" : "bg-ink-100 text-ink-700")} aria-hidden>
                {ok ? <Check className="h-4 w-4" strokeWidth={3} /> : <OptionShape i={i} className="h-4 w-4" />}
              </span>
              <h3 className="mt-3 text-[15px] font-semibold text-ink-900">{s.title}{ok && <span className="sr-only"> (done)</span>}</h3>
              <p className="mt-1 flex-1 text-[13px] leading-relaxed text-ink-600">{s.text}</p>
              {!ok && <Link href={s.href} className={cn("btn btn-sm mt-3 self-start no-underline", current ? "btn-primary" : "btn-secondary")}>{s.cta}</Link>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
