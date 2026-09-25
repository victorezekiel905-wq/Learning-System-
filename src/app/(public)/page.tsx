import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, BellRing, Check, Gamepad2, Layers, MonitorSmartphone, ShieldCheck, Sparkles } from "lucide-react";
import { getMe, homeFor } from "@/lib/session";

const PILLARS = [
  {
    n: "01", title: "Teach", icon: Layers,
    text: "Build a lesson from slides, video with checkpoint questions, whiteboards, or the PowerPoint, PDF or Word file you already have. Present it to every screen at once."
  },
  {
    n: "02", title: "Engage", icon: Sparkles,
    text: "Students pick their challenge level, explain their reasoning, earn XP and badges, and race each other in quiz games. You see how they think, not just what they tapped."
  },
  {
    n: "03", title: "Protect", icon: ShieldCheck,
    text: "Every student's screen as a thumbnail on your left. Tap one to see it full size, privately. Anyone who opens a game, switches app or closes the tab is flagged at once."
  }
];

const FACTS = [
  { big: "< 2 s", text: "from a student leaving the lesson to the alert on your screen" },
  { big: "3", text: "challenge levels in every activity, chosen by the student or by you" },
  { big: "12", text: "activity types, from multiple choice to drawing, code and rubrics" },
  { big: "0", text: "screen recordings stored. Live frames are never saved." }
];

const MODULES = [
  ["Studio", "Slides, interactive video, whiteboards and imported files, with a library of media and questions you reuse."],
  ["Assess", "Server-marked quizzes, short answers with rubrics, and a review queue for the work that needs a human."],
  ["Challenge", "Fast quiz games with streaks, teams and podiums. Leaderboards can be hidden for younger classes."],
  ["Live", "Responses as they arrive, a raise-hand queue, announcements and private chat, all in one room."],
  ["Guard", "Screen wall, lockdown, allow and block lists, and a built-in list of game and social sites blocked during lessons."],
  ["Insights", "Misconceptions by question, thinking level by Bloom's taxonomy, and reports for heads of department."]
];

export default async function Landing() {
  const me = await getMe();
  if (me?.profile) redirect(homeFor(me.profile.role));

  return (
    <main>
      {/* Hero */}
      <section className="mx-auto max-w-7xl px-4 pb-14 pt-12 sm:px-8 sm:pb-20 sm:pt-20">
        <p className="inline-flex items-center gap-2 rounded-full border border-ink-200 bg-white py-1 pl-1 pr-3 text-[13px] font-semibold text-ink-700">
          <span className="rounded-full bg-ink-900 px-2 py-0.5 text-[11px] font-bold text-white">New</span>
          Challenge levels, reasoning and XP for every activity
        </p>
        <h1 className="mt-6 max-w-5xl font-display text-[44px] font-extrabold leading-[0.98] tracking-tightest text-ink-900 sm:text-[68px] lg:text-[88px]">
          Every screen in the room. <span className="mark">One lesson</span> on all of them.
        </h1>
        <div className="mt-8 grid gap-8 lg:mt-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <p className="max-w-2xl text-lg leading-relaxed text-ink-600 sm:text-xl">
            SwiftCipher is the classroom platform for international primary and secondary schools. Lessons and games your students drive,
            and live screen monitoring that tells you the moment anyone wanders off.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/signup" className="btn btn-ink btn-lg no-underline">Create your school <ArrowRight className="h-4 w-4" aria-hidden /></Link>
            <Link href="/join" className="btn btn-secondary btn-lg no-underline">I have a class code</Link>
          </div>
        </div>
        <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-[13px] font-medium text-ink-600">
          {["Hosted in the EU (Ireland)", "Built for GDPR and NDPA", "Works on slow school Wi-Fi", "Phones, tablets, laptops and panels"].map((t) => (
            <li key={t} className="flex items-center gap-2"><Check className="h-4 w-4 text-ink-900" strokeWidth={2.6} aria-hidden />{t}</li>
          ))}
        </ul>
      </section>

      {/* The product, as the teacher sees it */}
      <section className="mx-auto max-w-7xl px-4 sm:px-8" aria-label="The live classroom">
        <ClassroomPicture />
      </section>

      {/* Three pillars */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-8 sm:py-28">
        <h2 className="max-w-3xl font-display text-[34px] font-extrabold leading-[1.05] tracking-tightest sm:text-5xl">
          Three jobs. Done properly, in one place.
        </h2>
        <div className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
          {PILLARS.map((p) => (
            <article key={p.n} className="border-t-2 border-ink-900 pt-6">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-bold text-ink-500">{p.n}</span>
                <p.icon className="h-6 w-6 text-ink-900" strokeWidth={1.8} aria-hidden />
              </div>
              <h3 className="mt-6 text-2xl font-extrabold tracking-tight">{p.title}</h3>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-600">{p.text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Facts band */}
      <section className="bg-ink-950 text-white">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-px bg-white/10 lg:grid-cols-4">
          {FACTS.map((f) => (
            <div key={f.big} className="bg-ink-950 px-4 py-8 sm:px-8 sm:py-14">
              <p className="font-display text-5xl font-extrabold leading-none tracking-tightest text-accent-400 sm:text-7xl">{f.big}</p>
              <p className="mt-3 max-w-[16rem] text-[13px] leading-snug text-ink-300 sm:mt-4 sm:text-[15px]">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Modules */}
      <section className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-8 sm:py-28 lg:grid-cols-[1fr_1.6fr]">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <h2 className="font-display text-[34px] font-extrabold leading-[1.05] tracking-tightest sm:text-5xl">Everything a lesson needs.</h2>
          <p className="mt-4 max-w-md text-lg text-ink-600">Six tools that share one roster, one gradebook and one set of permissions for every branch of your school.</p>
        </div>
        <dl className="divide-y divide-ink-200 border-y border-ink-200">
          {MODULES.map(([name, text]) => (
            <div key={name} className="grid gap-2 py-6 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-8">
              <dt className="font-display text-xl font-bold tracking-tight">{name}</dt>
              <dd className="text-[15px] leading-relaxed text-ink-600">{text}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Consent and privacy */}
      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-8 sm:pb-28">
        <div className="grid gap-10 rounded-3xl border border-ink-200 bg-white p-6 sm:p-12 lg:grid-cols-[1fr_1.3fr]">
          <div>
            <MonitorSmartphone className="h-8 w-8 text-ink-900" strokeWidth={1.8} aria-hidden />
            <h2 className="mt-6 font-display text-3xl font-extrabold leading-tight tracking-tightest sm:text-4xl">Monitoring families have agreed to.</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-ink-600">
              Parents give consent in the parent portal before any monitoring starts, and students always see when their screen is being shared.
            </p>
          </div>
          <ul className="grid gap-5 sm:grid-cols-2">
            {[
              ["Only during class", "Monitoring starts when the lesson starts and stops when it ends."],
              ["Nothing recorded", "Live frames go straight to the teacher and are never stored."],
              ["Fair on connections", "A dropped connection shows as connection lost, never as a violation."],
              ["Teachers decide", "Alerts are a prompt for the teacher. SwiftCipher never disciplines anyone."]
            ].map(([t, d]) => (
              <li key={t} className="rounded-2xl bg-ink-50 p-5">
                <p className="flex items-center gap-2 font-display font-bold"><Check className="h-4 w-4" strokeWidth={3} aria-hidden />{t}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{d}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Closing call */}
      <section className="bg-accent-500 text-accent-ink">
        <div className="mx-auto flex max-w-7xl flex-col items-start gap-8 px-4 py-16 sm:px-8 sm:py-24 lg:flex-row lg:items-end lg:justify-between">
          <h2 className="max-w-3xl font-display text-[40px] font-extrabold leading-[1] tracking-tightest text-inherit sm:text-6xl">Bring the whole class back to the lesson.</h2>
          <div className="flex flex-wrap gap-3">
            <Link href="/signup" className="btn btn-ink btn-lg no-underline">Create your school <ArrowRight className="h-4 w-4" aria-hidden /></Link>
            <Link href="/login" className="btn btn-lg border border-ink-900/20 text-ink-900 no-underline hover:bg-ink-900/5 hover:text-ink-900">Sign in</Link>
          </div>
        </div>
      </section>
    </main>
  );
}

/** A drawn picture of the teacher's live room (not a screenshot): the student rail, the lesson, and an alert. */
function ClassroomPicture() {
  const students = [
    { n: "Ada Okafor", c: "#E4E9FB" }, { n: "Tunde Bello", away: true }, { n: "Chiamaka Eze", c: "#E6F4D7" },
    { n: "David Mensah", c: "#FBE7DA" }, { n: "Amara Obi", c: "#EDE4F7" }, { n: "Kofi Asante", c: "#DCF1EE" }
  ];
  return (
    <figure className="overflow-hidden rounded-3xl bg-ink-950 p-2 sm:p-3" aria-label="Illustration: the teacher's live classroom">
      <div className="flex items-center gap-3 rounded-t-2xl px-3 py-3 text-white sm:px-4">
        <span className="rounded-md bg-rose-600 px-1.5 py-1 text-[10px] font-bold leading-none">LIVE</span>
        <span className="truncate text-sm font-semibold">Year 8 Mathematics · Equivalent fractions</span>
        <span className="ml-auto hidden rounded-lg bg-accent-500 px-2.5 py-1 font-mono text-sm font-extrabold tracking-[0.15em] text-accent-ink sm:inline">K7Q2XM</span>
      </div>
      <div className="grid gap-2 sm:gap-3 md:grid-cols-[200px_minmax(0,1fr)] lg:grid-cols-[220px_minmax(0,1fr)_260px]">
        <div className="grid grid-cols-3 gap-2 rounded-2xl bg-white/5 p-2 md:grid-cols-1 md:content-start">
          {students.map((s) => (
            <div key={s.n} className={`rounded-xl p-1.5 ${s.away ? "bg-rose-700" : "bg-white/5"}`}>
              <div className="aspect-video rounded-lg" style={{ background: s.away ? "#9F1239" : s.c }}>
                {!s.away && <div className="flex h-full flex-col justify-center gap-1 px-2"><span className="h-1 w-3/5 rounded bg-ink-900/70" /><span className="h-1 w-2/5 rounded bg-ink-900/30" /></div>}
                {s.away && <div className="grid h-full place-items-center text-[10px] font-extrabold text-white">LEFT LESSON</div>}
              </div>
              <p className="mt-1 truncate px-0.5 text-[11px] font-medium text-white">{s.n}</p>
            </div>
          ))}
        </div>
        <div className="flex min-h-[260px] flex-col justify-between rounded-2xl bg-white p-6 sm:p-10">
          <div>
            <span className="inline-block rounded-md bg-accent-400 px-2 py-0.5 text-[12px] font-bold text-accent-ink">Level 2 · Core</span>
            <p className="mt-5 font-display text-3xl font-extrabold leading-tight tracking-tightest text-ink-900 sm:text-5xl">Why is 2/4 the same as 1/2?</p>
            <p className="mt-3 max-w-md text-[15px] text-ink-600">Multiply or divide the top and the bottom by the same number. Explain your reasoning.</p>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100"><div className="h-full w-[72%] rounded-full bg-ink-900" /></div>
            <span className="text-[13px] font-semibold text-ink-700">18 of 25 answered</span>
          </div>
        </div>
        <div className="hidden flex-col gap-2 lg:flex">
          <div className="rounded-2xl bg-white p-4">
            <p className="flex items-center gap-2 text-[13px] font-bold text-rose-700"><BellRing className="h-4 w-4" aria-hidden />Tunde Bello left the lesson</p>
            <p className="mt-1 text-[13px] text-ink-600">Switched to another tab · 1.5 s ago</p>
          </div>
          <div className="rounded-2xl bg-white/5 p-4 text-white">
            <p className="flex items-center gap-2 text-[13px] font-bold"><Gamepad2 className="h-4 w-4 text-accent-400" aria-hidden />Game site blocked</p>
            <p className="mt-1 text-[13px] text-ink-300">Lesson focus: no games or social media</p>
          </div>
          <div className="flex-1 rounded-2xl bg-white/5 p-4 text-white">
            <p className="text-[13px] font-bold">Leaderboard</p>
            <ol className="mt-3 space-y-2 text-[13px]">
              {[["Chiamaka Eze", 1240], ["Ada Okafor", 1180], ["Kofi Asante", 990]].map(([n, xp], i) => (
                <li key={n} className="flex items-center gap-2">
                  <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold ${i === 0 ? "bg-accent-500 text-accent-ink" : "bg-white/10"}`}>{i + 1}</span>
                  <span className="flex-1 truncate text-ink-200">{n}</span><span className="font-mono text-ink-300">{xp} XP</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </figure>
  );
}
