"use client";
import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { OptionShape } from "@/components/game/Shape";
import { OPTION_COLORS } from "@/components/game/types";
import { cn } from "@/lib/utils";
import { Critter } from "@/components/live/Critter";

/*
 * The landing page's live lesson: a projector and two phones playing one
 * question, the way SwiftCipher runs it (countdown, answers arriving, reveal).
 * Built from the product's own tiles and shapes; example content only.
 */

type Q = { subject: string; n: string; prompt: string; options: string[]; right: number; counts: number[] };
const QUESTIONS: Q[] = [
  { subject: "Basic Science", n: "Question 3 of 8", prompt: "Which of these gives out its own light?", options: ["The Moon", "The Sun", "A mirror", "A window"], right: 1, counts: [4, 19, 2, 1] },
  { subject: "Mathematics", n: "Question 5 of 10", prompt: "What is ¾ as a percentage?", options: ["34%", "75%", "43%", "70%"], right: 1, counts: [3, 17, 1, 5] },
  { subject: "English", n: "Question 2 of 6", prompt: "Which word is spelt correctly?", options: ["Recieve", "Receive", "Receeve", "Reiceve"], right: 1, counts: [7, 16, 2, 1] }
];
const CLASS = 26;
const SECONDS = 20;
const TICK = 330;          // one countdown second, sped up for the page
const REVEAL_MS = 3800;
const BOARD_MS = 4200;     // the leaderboard after each question

// Example standings after each question (Ada answers right; Tunde, the second phone, doesn't).
const BOARD = [
  { name: "Ada", avatar: "fox", points: ["4,860", "6,140", "7,390"], move: "▲1" },
  { name: "Tobi", avatar: "panda", points: ["4,410", "5,520", "6,700"], move: "▼1" },
  { name: "Kemi", avatar: "owl", points: ["3,990", "5,180", "6,250"], move: "" },
  { name: "Tunde", avatar: "lion", points: ["3,580", "3,580", "4,710"], move: "" }
];

export function LiveDemo() {
  const [qi, setQi] = useState(0);
  const [left, setLeft] = useState(SECONDS);
  const [still, setStill] = useState(false);
  const [board, setBoard] = useState(false);

  useEffect(() => {
    let reduce = false;
    try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { /* old browsers */ }
    if (reduce) { setStill(true); setLeft(9); return; }
    let t: number;
    const run = (n: number) => {
      if (n > 0) { t = window.setTimeout(() => { setLeft(n - 1); run(n - 1); }, TICK); return; }
      t = window.setTimeout(() => {
        setBoard(true);
        t = window.setTimeout(() => { setBoard(false); setQi((i) => (i + 1) % QUESTIONS.length); setLeft(SECONDS); run(SECONDS); }, BOARD_MS);
      }, REVEAL_MS);
    };
    run(SECONDS);
    return () => window.clearTimeout(t);
  }, []);

  const q = QUESTIONS[qi]!;
  const reveal = left === 0 && !still;
  const elapsed = SECONDS - left;
  const total = q.counts.reduce((a, b) => a + b, 0);
  const answered = reveal ? total : Math.min(total, Math.round(total * Math.min(1, (elapsed / (SECONDS * 0.8)) ** 0.7)));
  const pickA = elapsed >= 5 || reveal ? q.right : null;                 // first phone: right, early
  const pickB = elapsed >= 9 || reveal ? (q.right + 2) % 4 : null;       // second phone: wrong, later
  const r = 44, c = 2 * Math.PI * r;

  return (
    <div className="pb-[200px] sm:pb-[236px]" role="img"
      aria-label={`Example of a live lesson: the class screen asks "${q.prompt}" with four coloured answers and a countdown; students answer on their phones, then the right answer is revealed and the leaderboard shown.`}>
      <div className="relative">
      {/* The class screen */}
      <div aria-hidden className="relative rounded-[22px] bg-ink-950 p-2.5 shadow-[0_40px_80px_-40px_rgb(0_0_0/0.55)] ring-1 ring-black/5">
        <div className="relative rounded-[14px] bg-[#16161a] px-5 pb-5 pt-4 text-white sm:px-8 sm:pb-8 sm:pt-6">
          {board && (
            <div className="absolute inset-0 z-10 flex flex-col rounded-[14px] bg-[#16161a] px-5 pb-5 pt-4 sm:px-8 sm:pb-7 sm:pt-6">
              <p className="text-[11px] text-white/55 sm:text-[13px]">{q.subject} · after {q.n.replace(/ of \d+/, "").toLowerCase()}</p>
              <p className="mt-1 font-display text-[19px] font-bold sm:text-[28px]">Leaderboard</p>
              <ol className="mt-2 flex flex-1 flex-col justify-center gap-1.5 sm:mt-3 sm:gap-2">
                {BOARD.map((b, i) => (
                  <li key={b.name} className="flex animate-pop items-center gap-2.5 rounded-xl bg-white/[0.07] px-3 py-1.5 text-[13px] font-semibold ring-1 ring-inset ring-white/10 sm:gap-3 sm:py-2.5 sm:text-lg"
                    style={{ animationDelay: `${i * 90}ms` }}>
                    <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full font-display text-[11px] font-extrabold sm:h-8 sm:w-8 sm:text-sm",
                      ["bg-tile-star text-ink-950", "bg-tile-bolt text-white", "bg-tile-hex text-white"][i] ?? "bg-white/15")}>{i + 1}</span>
                    <Critter name={b.avatar} className="h-6 w-6 sm:h-8 sm:w-8" />
                    <span className="flex-1">{b.name}</span>
                    {b.move && <span className={cn("text-[10px] font-bold sm:text-xs", b.move.startsWith("▲") ? "text-accent-400" : "text-rose-300")}>{b.move}</span>}
                    <span className="font-display font-bold tabular-nums">{b.points[qi]}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <div className="flex items-center justify-between text-[11px] text-white/55 sm:text-[13px]">
            <span>{q.subject} · {q.n}</span>
            <span className="hidden sm:inline">Code <span className="font-mono tracking-widest text-white/80">DV6-44Y</span></span>
          </div>
          <div className="mt-3 flex items-start justify-between gap-4 sm:mt-5">
            <p className="max-w-[26ch] font-display text-[19px] font-bold leading-snug sm:text-[30px]">{q.prompt}</p>
            <div className="flex shrink-0 flex-col items-center">
              <div className="relative h-14 w-14 sm:h-20 sm:w-20">
                <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
                  <circle cx="50" cy="50" r={r} fill="none" stroke="white" strokeOpacity={0.12} strokeWidth="8" />
                  <circle cx="50" cy="50" r={r} fill="none" strokeWidth="8" strokeLinecap="round"
                    className={cn("transition-[stroke-dashoffset] duration-300 ease-linear", left <= 5 && !still ? "stroke-rose-500" : "stroke-accent-400")}
                    strokeDasharray={c} strokeDashoffset={c * (1 - left / SECONDS)} />
                </svg>
                <span className="absolute inset-0 grid place-items-center font-display text-xl font-bold tabular-nums sm:text-3xl">{reveal ? "0" : left}</span>
              </div>
              <span className="mt-1.5 text-[11px] tabular-nums text-white/60 sm:text-[13px]">{answered} of {CLASS} answered</span>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:mt-6 sm:gap-3">
            {q.options.map((o, i) => (
              <div key={o} className={cn("flex items-center gap-2.5 rounded-xl px-3 py-3 text-[13px] font-semibold transition-opacity duration-500 sm:px-4 sm:py-4 sm:text-lg",
                OPTION_COLORS[i], reveal && i !== q.right && "opacity-30")}>
                <OptionShape i={i} className="h-4 w-4 shrink-0 sm:h-6 sm:w-6" />
                <span className="min-w-0 flex-1 truncate">{o}</span>
                {reveal && <span className="tabular-nums">{q.counts[i]}</span>}
                {reveal && i === q.right && <Check className="h-4 w-4 sm:h-6 sm:w-6" strokeWidth={3} />}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Two students' phones */}
      <div aria-hidden className="pointer-events-none absolute right-4 top-full -mt-3 flex items-start gap-3 sm:right-10 sm:-mt-4 sm:gap-4">
        <Phone className="hidden sm:block" q={q} pick={pickB} reveal={reveal} name="Tunde" />
        <Phone q={q} pick={pickA} reveal={reveal} name="Ada" lead />
      </div>
      </div>
    </div>
  );
}

function Phone({ q, pick, reveal, name, lead, className }: { q: Q; pick: number | null; reveal: boolean; name: string; lead?: boolean; className?: string }) {
  const right = pick === q.right;
  return (
    <div className={cn("w-[112px] rounded-[24px] bg-ink-950 p-[5px] shadow-[0_30px_60px_-25px_rgb(0_0_0/0.6)] sm:w-[128px]", lead ? "rotate-[3deg]" : "-rotate-[3deg]", className)}>
      <div className="flex aspect-[9/18.5] flex-col overflow-hidden rounded-[21px] bg-ink-50">
        <div className="flex items-center justify-between px-3 pb-1.5 pt-2.5 text-[8px] font-semibold text-ink-500 sm:text-[9px]">
          <span>{name}</span><span className="tabular-nums">{reveal && right ? "4,860" : "3,580"} pts</span>
        </div>
        {reveal && pick !== null ? (
          <div className={cn("m-2 flex flex-1 flex-col items-center justify-center rounded-2xl px-2 text-center text-white", right ? "bg-emerald-700" : "bg-rose-700")}>
            <p className="font-display text-[15px] font-bold leading-tight sm:text-lg">{right ? "Correct!" : "Not quite"}</p>
            <p className="mt-1 text-[11px] font-semibold sm:text-xs">{right ? "+1,280" : `Answer: ${q.options[q.right]}`}</p>
            {right && <p className="mt-0.5 text-[10px] text-white/90">3 in a row</p>}
          </div>
        ) : pick !== null ? (
          <div className={cn("m-2 flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl text-white", OPTION_COLORS[pick])}>
            <OptionShape i={pick} className="h-7 w-7" />
            <p className="px-2 text-center text-[11px] font-semibold leading-tight sm:text-xs">Answer locked in</p>
          </div>
        ) : (
          <div className="grid flex-1 grid-cols-2 gap-1.5 p-2">
            {q.options.map((o, i) => (
              <div key={o} className={cn("flex flex-col items-center justify-center gap-1 rounded-xl text-white", OPTION_COLORS[i])}>
                <OptionShape i={i} className="h-5 w-5" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
