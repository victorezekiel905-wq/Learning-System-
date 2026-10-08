import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { getMe, homeFor } from "@/lib/session";
import { LEGAL } from "@/lib/legal";
import { LiveDemo } from "@/components/marketing/LiveDemo";
import { AnswerMini, DesignMini, Frame, ParentMini, ReviewMini, RevealMini, SchoolMini, TeachMini } from "@/components/marketing/Showcase";

export const metadata = {
  title: { absolute: "SwiftCipher · Lessons your whole class plays together" },
  description: "Teach from your own slides, ask a question and every student answers on their phone. Results arrive as you reveal them, and parents follow progress in every subject."
};

const STEPS = [
  { title: "Design", text: "Lay out slides with text, pictures and shapes, or bring in your PDF and PowerPoint files.", art: <DesignMini />, dark: false },
  { title: "Teach", text: "Your screen leads. Every student sees the slide you are on and the question you ask.", art: <TeachMini />, dark: true },
  { title: "Answer", text: "Students tap a colour on any phone or laptop. They join with a code; there is nothing to install.", art: <AnswerMini />, dark: false },
  { title: "Review", text: "After the lesson: who took part, how each question went, and the most common wrong answer.", art: <ReviewMini />, dark: false }
];

const CLASSROOM = [
  ["Any device with a browser", "Phones, tablets, laptops and classroom panels. Nothing to install, nothing to update."],
  ["Slow Wi-Fi", "If the connection drops, answers wait on the device and send themselves when it comes back."],
  ["The slides you already have", "Import PDF and PowerPoint files and add questions between them, or design new slides here."],
  ["Private by design", "Students see their own results, parents their own children, and teachers their own subjects."],
  ["Data you control", `Stored in ${LEGAL.hostingRegion.replace(/^European Union: /, "the EU, ")}. Export or delete it whenever you choose.`],
  ["Monitoring only if you want it", "An optional add-on: live screens during class only, and only with parents' agreement."]
] as const;

const FAQ = [
  ["Do students need an account?", "Not for a live lesson. They type the code on your screen and their name. With an account, their progress is kept from lesson to lesson and their parents can follow it."],
  ["Can I use the slides I already have?", "Yes. Import a PDF or PowerPoint file, then add questions, polls and quizzes between the slides. You can also design slides from scratch in SwiftCipher."],
  ["What does it cost?", "One teacher with up to three classes is free. Whole-school plans add school leaders, parent accounts and more storage. Talk to us and we will price it for your school."],
  ["What happens when the internet is slow?", "SwiftCipher is built for school Wi-Fi. Pages stay light, and if a student loses the connection mid-question, the answer is kept on the device and sent when it returns."],
  ["Who can see a child's results?", "The student, their parents, the teachers of their subjects (for those subjects only) and the school's leaders. No other family, and no other school."],
  ["How do parents join?", "The school gives each family a private code for each child. Parents sign up with it, and add a second child to the same account with that child's code."]
] as const;

export default async function Landing() {
  const me = await getMe();
  if (me?.profile) redirect(homeFor(me.profile.role));

  return (
    <main className="overflow-x-clip">
      {/* Opening */}
      <section className="mx-auto grid max-w-6xl items-center gap-x-14 gap-y-12 px-5 pb-28 pt-14 sm:px-8 sm:pt-20 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:pb-32 lg:pt-24">
        <div>
          <h1 className="font-display text-[40px] font-bold leading-[1.04] tracking-[-0.03em] text-ink-900 sm:text-[52px] lg:text-[58px]">
            Lessons your whole class plays together.
          </h1>
          <p className="mt-6 max-w-[32rem] text-[17px] leading-[1.65] text-ink-600 sm:text-lg">
            Teach from your own slides. Ask a question and every student answers on their phone, with a countdown and points.
            Results arrive the moment you reveal them, and parents can follow progress in every subject.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link href="/signup" className="btn btn-ink btn-lg no-underline">Create your school</Link>
            <Link href="#lesson" className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-ink-900 no-underline hover:text-brand-700">
              See how a lesson runs <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          <p className="mt-5 text-[13px] text-ink-500">Free for one teacher and up to three classes.</p>
        </div>
        <LiveDemo />
      </section>

      {/* A lesson, step by step */}
      <section id="lesson" className="scroll-mt-20 border-t border-ink-200/80">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 lg:py-28">
          <div className="max-w-2xl">
            <h2 className="font-display text-[30px] font-bold leading-[1.12] tracking-[-0.02em] text-ink-900 sm:text-[38px]">How a lesson runs.</h2>
            <p className="mt-4 text-[17px] leading-relaxed text-ink-600">The same lesson works at the front of the room, on every student&apos;s device, and in the report you read afterwards.</p>
          </div>
          <ol className="mt-14 grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.title}>
                <Frame dark={s.dark} fixed>{s.art}</Frame>
                <h3 className="mt-5 text-[15px] font-semibold text-ink-900">{s.title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-ink-600">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* The game */}
      <section className="bg-ink-950 text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-24 sm:px-8 lg:grid-cols-2 lg:py-28">
          <div>
            <h2 className="font-display text-[30px] font-bold leading-[1.12] tracking-[-0.02em] text-white sm:text-[38px]">Quiz like a game, without leaving the lesson.</h2>
            <p className="mt-5 max-w-[34rem] text-[17px] leading-relaxed text-ink-300">
              Questions sit between your slides. The class shares one countdown, earns points for right answers and for speed, and builds streaks.
              When time is up the answers close, and the right one appears on the big screen with how many chose each option.
            </p>
            <p className="mt-4 max-w-[34rem] text-[17px] leading-relaxed text-ink-300">
              Show the leaderboard when it helps, and keep it hidden for younger classes or quiet checks. Music for the room is built in.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-[1.2fr_1fr]">
            <div className="rounded-2xl bg-white/[0.04] ring-1 ring-white/10"><RevealMini /></div>
            <div className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10" aria-hidden>
              <p className="text-[12px] font-semibold text-white/60">Leaderboard</p>
              <ol className="mt-3 space-y-2.5 text-[14px]">
                {[["Ada", "4,860", "+1"], ["Tobi", "4,410", "−1"], ["Kemi", "3,990", ""], ["Femi", "3,720", "+2"]].map(([n, p, d], i) => (
                  <li key={n} className="flex items-center gap-3">
                    <span className="w-4 text-right font-semibold tabular-nums text-white/50">{i + 1}</span>
                    <span className="flex-1 font-semibold">{n}</span>
                    <span className="text-[11px] text-white/45">{d}</span>
                    <span className="font-display font-bold tabular-nums">{p}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* Parents */}
      <section id="parents" className="scroll-mt-20">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-24 sm:px-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:py-28">
          <div>
            <h2 className="font-display text-[30px] font-bold leading-[1.12] tracking-[-0.02em] text-ink-900 sm:text-[38px]">Parents see each subject, not just a score.</h2>
            <p className="mt-5 text-[17px] leading-relaxed text-ink-600">
              Every family sees their own child&apos;s progress: lessons attended, right answers, and the topics where help is needed, by week, month, term or year.
            </p>
            <p className="mt-4 text-[17px] leading-relaxed text-ink-600">
              Parents write to each subject teacher from the same page, and teachers reply. A parent with three children at the school signs up once and sees all three.
            </p>
          </div>
          <Frame caption="Example report" className="lg:pl-4"><div className="bg-ink-50/70"><ParentMini /></div></Frame>
        </div>
      </section>

      {/* School leaders */}
      <section id="schools" className="scroll-mt-20 border-t border-ink-200/80">
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-5 py-24 sm:px-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:py-28">
          <Frame caption="Example: the whole school over one term" className="order-last lg:order-first lg:pr-4"><SchoolMini /></Frame>
          <div>
            <h2 className="font-display text-[30px] font-bold leading-[1.12] tracking-[-0.02em] text-ink-900 sm:text-[38px]">Know where pupils struggle, long before exams.</h2>
            <p className="mt-5 text-[17px] leading-relaxed text-ink-600">
              School leaders see every subject broken down by topic, the pupils who need help, and what parents are asking teachers.
            </p>
            <p className="mt-4 text-[17px] leading-relaxed text-ink-600">
              Teachers see the same for the subjects they teach, and a report after every lesson.
            </p>
          </div>
        </div>
      </section>

      {/* Practicalities */}
      <section className="border-t border-ink-200/80 bg-white">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 lg:py-28">
          <h2 className="max-w-2xl font-display text-[30px] font-bold leading-[1.12] tracking-[-0.02em] text-ink-900 sm:text-[38px]">Made for real classrooms.</h2>
          <dl className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {CLASSROOM.map(([t, d]) => (
              <div key={t} className="border-t border-ink-200 pt-5">
                <dt className="text-[15px] font-semibold text-ink-900">{t}</dt>
                <dd className="mt-2 text-[15px] leading-relaxed text-ink-600">{d}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Questions */}
      <section id="faq" className="scroll-mt-20 border-t border-ink-200/80">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-24 sm:px-8 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:py-28">
          <div>
            <h2 className="font-display text-[30px] font-bold leading-[1.12] tracking-[-0.02em] text-ink-900 sm:text-[38px]">Questions schools ask.</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-600">
              Anything else: <a href={`mailto:${LEGAL.infoEmail}`}>{LEGAL.infoEmail}</a>
            </p>
          </div>
          <div className="divide-y divide-ink-200 border-y border-ink-200">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[16px] font-semibold text-ink-900 [&::-webkit-details-marker]:hidden">
                  {q}<span aria-hidden className="text-xl font-normal leading-none text-ink-400 transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 max-w-[40rem] text-[15px] leading-relaxed text-ink-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Start */}
      <section className="bg-ink-950 text-white">
        <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 lg:py-28">
          <div className="flex flex-wrap items-end justify-between gap-8">
            <div className="max-w-xl">
              <h2 className="font-display text-[30px] font-bold leading-[1.12] tracking-[-0.02em] text-white sm:text-[38px]">Run your next lesson on SwiftCipher.</h2>
              <p className="mt-4 text-[17px] leading-relaxed text-ink-300">Create your school in a few minutes, or talk to us about bringing in your whole staff.</p>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link href="/signup" className="btn btn-lg bg-white text-ink-950 no-underline hover:bg-ink-100 hover:text-ink-950">Create your school</Link>
              <a href={`mailto:${LEGAL.infoEmail}`} className="text-[15px] font-semibold text-white no-underline hover:text-accent-300">Talk to us</a>
            </div>
          </div>
          <div className="mt-16 grid gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-3" aria-label="Sign in">
            {([
              ["student", "Students", "Join your lessons and see your progress.", "Join with your class code"],
              ["parent", "Parents", "Follow each of your children, subject by subject.", "Sign up with your child's code"],
              ["staff", "Staff", "Teach live and see how your classes are doing.", "Use your invite from the school"]
            ] as const).map(([who, title, text, signup]) => (
              <div key={who} className="bg-ink-950 p-6">
                <p className="text-[15px] font-semibold text-white">{title}</p>
                <p className="mt-1 text-[14px] leading-relaxed text-ink-400">{text}</p>
                <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
                  <Link href={`/login?as=${who}`} className="font-semibold text-white no-underline hover:text-accent-300">Sign in</Link>
                  <Link href={`/signup?as=${who}`} className="text-ink-400 no-underline hover:text-white">{signup}</Link>
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
