import { Check } from "lucide-react";
import { CanvasFrame } from "@/components/slides/CanvasView";
import { OptionShape } from "@/components/game/Shape";
import { OPTION_COLORS } from "@/components/game/types";
import type { CanvasContent } from "@/slides/canvas";
import { cn } from "@/lib/utils";

/*
 * Small, faithful pictures of SwiftCipher screens for the landing page, drawn
 * with the product's own pieces. Every name and number is example content.
 */

// Charts use the tile palette: teal (moon) when strong, orange (heart) where help is needed, cobalt (bolt) otherwise.
const tone = (p: number) => (p < 50 ? "bg-tile-heart" : p >= 80 ? "bg-tile-moon" : "bg-tile-bolt");
const SUBJECT_DOT: Record<string, string> = { Mathematics: "bg-tile-bolt", "Basic Science": "bg-tile-moon", English: "bg-tile-hex", "Social Studies": "bg-tile-heart" };
function Dot({ subject }: { subject: string }) {
  return <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", SUBJECT_DOT[subject] ?? "bg-ink-400")} aria-hidden />;
}
function Meter({ v, className }: { v: number; className?: string }) {
  return <span className={cn("block h-1.5 overflow-hidden rounded-full bg-ink-100", className)}><span className={cn("block h-full rounded-full", tone(v))} style={{ width: `${v}%` }} /></span>;
}

/** A frame for each picture: a quiet surface with a caption under it. */
export function Frame({ children, caption, className, dark, fixed }: { children: React.ReactNode; caption?: string; className?: string; dark?: boolean; fixed?: boolean }) {
  return (
    <figure className={className}>
      <div aria-hidden className={cn("overflow-hidden rounded-2xl ring-1", dark ? "bg-ink-950 ring-black/10" : "bg-white ring-ink-200/80",
        fixed && "flex h-[236px] flex-col justify-center")}>{children}</div>
      {caption && <figcaption className="mt-3 text-[13px] text-ink-500">{caption}</figcaption>}
    </figure>
  );
}

const SLIDE: CanvasContent = {
  background: { color: "#ffffff" },
  elements: [
    { id: "s1", type: "shape", shape: "round", x: 900, y: 140, w: 600, h: 620, fill: "#f5f3ef", stroke: "transparent", strokeWidth: 0 },
    { id: "s2", type: "shape", shape: "ellipse", x: 1040, y: 250, w: 300, h: 300, fill: "#f59e0b", stroke: "transparent", strokeWidth: 0 },
    { id: "s3", type: "shape", shape: "arrow", x: 1010, y: 610, w: 380, h: 60, fill: "#111827", stroke: "transparent", strokeWidth: 10 },
    { id: "t1", type: "text", x: 90, y: 100, w: 780, h: 400, text: "Light travels in straight lines", size: 100, bold: true, font: "display", color: "#111827", align: "left", valign: "top" },
    { id: "t2", type: "text", x: 90, y: 640, w: 780, h: 360, text: "That is why shadows form\nSome objects give out light", size: 54, color: "#475569", font: "sans", align: "left", valign: "top", list: true }
  ]
};

/** The slide designer: a slide on the canvas with a selected element. */
export function DesignMini() {
  return (
    <div className="flex h-full flex-col justify-center bg-ink-50 p-3">
      <div className="mb-2 flex gap-1.5 text-[10px] font-semibold text-ink-600">
        {["Text", "Picture", "Shape"].map((t) => <span key={t} className="rounded-md bg-white px-2 py-1 ring-1 ring-ink-200">{t}</span>)}
      </div>
      <div className="relative">
        <CanvasFrame content={SLIDE} className="rounded-lg ring-1 ring-ink-200" />
        <span className="pointer-events-none absolute rounded-sm outline outline-2 outline-brand-500" style={{ left: "65%", top: "27.8%", width: "18.75%", height: "33.3%" }} />
      </div>
    </div>
  );
}

const OPTS = ["The Moon", "The Sun", "A mirror", "A window"];

/** The class screen during a question. */
export function TeachMini() {
  return (
    <div className="p-4 text-white">
      <div className="flex items-center justify-between text-[10px] text-white/55"><span>Question 3 of 8</span><span className="tabular-nums">21 of 26 answered</span></div>
      <p className="mt-2 font-display text-[15px] font-bold leading-snug">Which of these gives out its own light?</p>
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {OPTS.map((o, i) => (
          <div key={o} className={cn("flex items-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-semibold", OPTION_COLORS[i])}>
            <OptionShape i={i} className="h-3.5 w-3.5 shrink-0" />{o}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A student's phone: tap a colour to answer. */
export function AnswerMini() {
  return (
    <div className="flex h-full items-end justify-center bg-ink-100/60 px-4 pt-5">
      <div className="w-[150px] rounded-t-[24px] bg-ink-950 p-[5px] pb-0">
        <div className="rounded-t-[19px] bg-ink-50 px-2 pb-3 pt-2.5">
          <p className="px-1 text-[9px] font-semibold text-ink-500">Question 3 · 14 s left</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {OPTS.map((o, i) => (
              <div key={o} className={cn("flex h-14 flex-col items-center justify-center gap-1 rounded-xl text-white", OPTION_COLORS[i], i === 1 && "ring-2 ring-ink-950 ring-offset-1")}>
                <OptionShape i={i} className="h-5 w-5" /><span className="text-[9px] font-semibold">{o}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The report after the lesson: one question in detail. */
export function ReviewMini() {
  const rows: [string, number, boolean, number][] = [["The Sun", 19, true, 1], ["The Moon", 4, false, 0], ["A mirror", 2, false, 2], ["A window", 1, false, 3]];
  return (
    <div className="p-4">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-semibold text-ink-500">Question 3</p>
        <p className="font-display text-lg font-bold">73% <span className="text-[11px] font-normal text-ink-500">right</span></p>
      </div>
      <p className="mt-1 text-[13px] font-semibold text-ink-900">Which of these gives out its own light?</p>
      <ul className="mt-3 space-y-1.5">
        {rows.map(([l, n, ok, t], i) => (
          <li key={l} className="grid grid-cols-[5.5rem_1fr_1.25rem] items-center gap-2 text-[11px]">
            <span className={cn("flex min-w-0 items-center gap-1", ok && "font-semibold text-ink-900")}><OptionShape i={t} className={cn("h-3 w-3 shrink-0", ["text-tile-bolt", "text-[#7E9A12]", "text-tile-hex", "text-tile-moon"][t])} /><span className="truncate">{l}</span>{ok && <Check className="h-3 w-3 shrink-0" strokeWidth={3} />}</span>
            <span className="block h-3 overflow-hidden rounded bg-ink-100"><span className={cn("block h-full rounded", OPTION_COLORS[t], !ok && "opacity-45")} style={{ width: `${(n / 19) * 100}%` }} /></span>
            <span className="text-right tabular-nums text-ink-600">{n}</span>
            {i === 1 && <span className="col-span-3 -mt-0.5 text-[10px] font-semibold text-tile-heart">Most common wrong answer</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What a parent sees for one child. */
export function ParentMini() {
  const subjects: [string, number, [string, number][]][] = [
    ["Mathematics", 64, [["Decimals", 39], ["Ratio", 58], ["Fractions", 87]]],
    ["Basic Science", 79, [["Light", 67], ["Living things", 85]]]
  ];
  return (
    <div className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5 text-[11px] font-semibold">
          <span className="rounded-md bg-ink-900 px-2.5 py-1 text-white">Ada</span>
          <span className="rounded-md bg-white px-2.5 py-1 text-ink-700 ring-1 ring-ink-200">Tobi</span>
        </div>
        <div className="flex rounded-lg bg-white p-0.5 text-[10px] font-semibold ring-1 ring-ink-200">
          {["Week", "Month", "Term", "Year"].map((p) => <span key={p} className={cn("rounded-md px-2 py-0.5", p === "Term" ? "bg-ink-900 text-white" : "text-ink-600")}>{p}</span>)}
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[["Lessons", "22 of 24"], ["Right answers", "70%"], ["Change", "+6 pts"]].map(([l, v]) => (
          <div key={l} className="rounded-xl bg-white p-3 ring-1 ring-ink-200">
            <p className="text-[10px] text-ink-500">{l}</p><p className="mt-0.5 font-display text-lg font-bold text-ink-900">{v}</p>
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-xl bg-white p-3 ring-1 ring-ink-200">
          <p className="text-[11px] font-semibold text-ink-900">Strong in</p>
          <p className="mt-1.5 flex justify-between text-[11px]"><span>Fractions · Mathematics</span><span className="font-semibold text-tile-moon">87%</span></p>
          <p className="mt-1 flex justify-between text-[11px]"><span>Living things · Basic Science</span><span className="font-semibold text-tile-moon">85%</span></p>
        </div>
        <div className="rounded-xl bg-white p-3 ring-1 ring-ink-200">
          <p className="text-[11px] font-semibold text-ink-900">Needs more practice</p>
          <p className="mt-1.5 flex justify-between text-[11px]"><span>Decimals · Mathematics</span><span className="font-semibold text-tile-heart">39%</span></p>
          <p className="mt-1 flex justify-between text-[11px]"><span>Ratio · Mathematics</span><span className="font-semibold text-tile-heart">58%</span></p>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {subjects.map(([s, v, topics]) => (
          <div key={s} className="rounded-xl bg-white p-3 ring-1 ring-ink-200">
            <p className="flex justify-between text-[12px] font-semibold text-ink-900"><span className="flex items-center gap-1.5"><Dot subject={s} />{s}</span><span>{v}%</span></p>
            <Meter v={v} className="mt-1.5" />
            <ul className="mt-2 space-y-1">{topics.map(([t, p]) => (
              <li key={t} className="grid grid-cols-[1fr_3rem_2rem] items-center gap-2 text-[10px] text-ink-700"><span>{t}</span><Meter v={p} /><span className="text-right tabular-nums">{p}%</span></li>
            ))}</ul>
          </div>
        ))}
      </div>
      <div className="mt-3 rounded-xl bg-white p-3 text-[11px] ring-1 ring-ink-200">
        <p className="text-ink-500">To Mr Bello, Mathematics</p>
        <p className="mt-0.5 text-ink-800">Ada finds decimals hard at home. What can we practise?</p>
        <p className="mt-2 rounded-lg bg-brand-50 px-2.5 py-1.5 text-ink-800"><b>Mr Bello:</b> Thank you. I&apos;ll send a short practice set on Monday.</p>
      </div>
    </div>
  );
}

/** What a head teacher sees for the school. */
export function SchoolMini() {
  const topics: [string, string, number, number][] = [["Decimals", "Mathematics", 41, 23], ["Comprehension", "English", 52, 17], ["Forces", "Basic Science", 56, 14], ["Map reading", "Social Studies", 58, 11]];
  return (
    <div className="p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] font-semibold text-ink-900">Whole school · First term</p>
        <p className="text-[11px] text-ink-500">412 of 436 pupils taking part</p>
      </div>
      <p className="mt-4 text-[11px] font-semibold text-ink-500">Hardest topics</p>
      <ul className="mt-2 space-y-2.5">
        {topics.map(([t, s, p, n]) => (
          <li key={t} className="grid grid-cols-[minmax(0,1fr)_5rem_2.25rem] items-center gap-3">
            <span className="min-w-0"><span className="flex items-center gap-1.5 truncate text-[12px] font-semibold text-ink-900"><Dot subject={s} />{t} <span className="font-normal text-ink-500">· {s}</span></span>
              <span className="text-[10px] text-ink-500">{n} pupils below 50%</span></span>
            <Meter v={p} /><span className="text-right text-[12px] font-semibold tabular-nums">{p}%</span>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex items-center justify-between rounded-xl bg-ink-50 px-3 py-2.5 text-[11px]">
        <span className="text-ink-700">Parent feedback this term</span><span className="font-semibold text-ink-900">38 · 3 waiting for a reply</span>
      </div>
    </div>
  );
}

/** The reveal on the class screen. */
export function RevealMini() {
  const counts = [4, 19, 2, 1];
  return (
    <div className="flex h-full items-end justify-center gap-3 px-5 pb-4 pt-6">
      {counts.map((n, i) => (
        <div key={i} className={cn("flex w-11 flex-col items-center gap-1", i !== 1 && "opacity-40")}>
          <span className="flex items-center gap-0.5 font-display text-sm font-bold text-white">{i === 1 && <Check className="h-3.5 w-3.5" strokeWidth={3} />}{n}</span>
          <div className={cn("w-full rounded-t-md", OPTION_COLORS[i])} style={{ height: `${Math.max(8, (n / 19) * 90)}px` }} />
          <span className={cn("grid h-6 w-full place-items-center rounded-b-md text-white", OPTION_COLORS[i])}><OptionShape i={i} className="h-3.5 w-3.5" /></span>
        </div>
      ))}
    </div>
  );
}
