import { OptionShape } from "@/components/game/Shape";
import { OPTION_COLORS } from "@/components/game/types";
import { ParentMini, ReviewMini, TeachMini } from "@/components/marketing/Showcase";
import type { Who } from "@/lib/who";
import { cn } from "@/lib/utils";

/*
 * The picture beside the sign-in and sign-up forms: what each kind of account
 * actually gets, drawn with the product's own pieces. Example content only.
 */

const OPTS = ["The Moon", "The Sun", "A mirror", "A window"];

function StudentArt() {
  return (
    <div className="relative -translate-x-10">
      <div className="w-[236px] rounded-[34px] bg-ink-800 p-[7px] shadow-[0_40px_80px_-30px_rgb(0_0_0/0.8)] ring-1 ring-white/10">
        <div className="overflow-hidden rounded-[28px] bg-ink-50">
          <div className="flex items-center justify-between px-4 pb-2 pt-3.5 text-[10px] font-semibold text-ink-500">
            <span>Basic Science · Q3</span><span className="tabular-nums">12 s</span>
          </div>
          <div className="mx-3 h-1 overflow-hidden rounded-full bg-ink-200"><div className="h-full w-[60%] rounded-full bg-ink-900" /></div>
          <p className="px-4 pb-3 pt-3 font-display text-[15px] font-bold leading-snug text-ink-900">Which of these gives out its own light?</p>
          <div className="grid grid-cols-2 gap-2 px-3 pb-4">
            {OPTS.map((o, i) => (
              <div key={o} className={cn("flex h-[74px] flex-col items-center justify-center gap-1.5 rounded-2xl text-white", OPTION_COLORS[i], i === 1 && "ring-[3px] ring-ink-900 ring-offset-2 ring-offset-ink-50")}>
                <OptionShape i={i} className="h-6 w-6" /><span className="text-[10px] font-semibold">{o}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="absolute -bottom-8 -right-32 w-[168px] rounded-2xl bg-emerald-700 p-4 text-white shadow-[0_24px_48px_-20px_rgb(0_0_0/0.7)]">
        <p className="font-display text-xl font-bold leading-none">Correct!</p>
        <p className="mt-2 font-display text-lg font-bold tabular-nums">+1,280</p>
        <p className="mt-0.5 text-[12px] text-white/90">3 in a row · 2nd place</p>
      </div>
    </div>
  );
}

function ParentArt() {
  return (
    <div className="w-[440px] max-w-full overflow-hidden rounded-2xl bg-ink-50 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.8)]">
      <ParentMini />
    </div>
  );
}

function StaffArt() {
  return (
    <div className="relative w-[420px] max-w-full">
      <div className="overflow-hidden rounded-2xl bg-[#16161a] ring-1 ring-white/10"><TeachMini /></div>
      <div className="relative -mt-6 ml-auto w-[300px] overflow-hidden rounded-2xl bg-white shadow-[0_32px_64px_-24px_rgb(0_0_0/0.8)]"><ReviewMini /></div>
    </div>
  );
}

export const AUTH_ART: Record<Who | "school", { art: React.ReactNode; title: string; text: string }> = {
  student: { art: <StudentArt />, title: "Every lesson, played together.", text: "Answer on your phone, see your points, and find out what to practise next." },
  parent: { art: <ParentArt />, title: "Your child's progress, subject by subject.", text: "Lessons attended, right answers and the topics that need help, for each of your children." },
  staff: { art: <StaffArt />, title: "Teach live, then see how every question went.", text: "Design your slides, ask questions everyone answers, and read the report after class." },
  school: { art: <StaffArt />, title: "Set up your school in minutes.", text: "Add staff, classes and term dates. Students join with a class code, parents with their child's code." }
};
