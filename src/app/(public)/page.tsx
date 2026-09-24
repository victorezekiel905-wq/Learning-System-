import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe, homeFor } from "@/lib/session";

const MODULES = [
  { name: "Studio", text: "Build lessons from slides, video with checkpoint questions, whiteboards and imported PowerPoint, PDF or Word files." },
  { name: "Assess", text: "Twelve activity types, from multiple choice and matching to drawing, code and rubric-graded work, marked on the server." },
  { name: "Challenge", text: "Fast quiz games with speed and streak bonuses, teams, podiums, and leaderboards you can hide." },
  { name: "Live", text: "One classroom workspace: live responses, raise-hand queue, announcements and private chat." },
  { name: "Guard", text: "Screen wall, spotlight, allow and block lists, and tab commands for managed browsers during class." },
  { name: "Insights", text: "Learning analytics and focus signals, reported separately, each with its own retention settings." }
];

export default async function Landing() {
  const me = await getMe();
  if (me?.profile) redirect(homeFor(me.profile.role));

  return (
    <main className="mx-auto max-w-6xl px-6 pb-16">
      <section className="grid items-center gap-10 py-12 lg:grid-cols-2">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">The classroom operating system</p>
          <h1 className="mt-3 text-4xl font-extrabold leading-tight text-ink-900 sm:text-5xl">
            Teach, assess and keep focus — <span className="text-brand-600">without switching apps.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-ink-600">
            SwiftCipher combines interactive lessons, live assessment, competitive quizzes and school-managed device focus
            in one privacy-first, multi-tenant workspace.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className="btn btn-primary btn-lg no-underline">Create your school</Link>
            <Link href="/join" className="btn btn-secondary btn-lg no-underline">I have a code</Link>
          </div>
          <p className="mt-4 text-sm text-ink-500">Free for individual teachers. Built for low-bandwidth classrooms.</p>
        </div>
        <div className="card overflow-hidden p-0 shadow-xl">
          <div className="flex items-center justify-between border-b border-ink-100 bg-ink-50 px-4 py-2 text-xs text-ink-500">
            <span>Year 8 ICT · Web Design</span>
            <span className="badge bg-emerald-50 text-emerald-700">● Live · 27/28</span>
          </div>
          <div className="grid grid-cols-4 gap-2 p-4">
            {["Ada", "Alan", "Grace", "Kat", "Linus", "Tim", "Margaret", "Dennis"].map((n, i) => (
              <div key={n} className={`rounded-lg border p-2 text-center text-[11px] ${i === 2 ? "border-rose-300 bg-rose-50" : "border-ink-200 bg-white"}`}>
                <div className="mb-1 aspect-video rounded bg-gradient-to-br from-brand-100 to-accent-100" />
                {n}{i === 2 && <span className="block text-rose-700">left environment</span>}
              </div>
            ))}
          </div>
          <div className="flex gap-2 border-t border-ink-100 px-4 py-3 text-xs">
            {["Spotlight", "Open tab", "Close tab", "Redirect", "Focus"].map((a) => <span key={a} className="badge bg-brand-50 text-brand-700">{a}</span>)}
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {MODULES.map((m) => (
          <div key={m.name} className="card card-pad">
            <p className="text-xs font-semibold uppercase tracking-wider text-accent-700">SwiftCipher</p>
            <h2 className="text-lg font-bold">{m.name}</h2>
            <p className="mt-1 text-sm text-ink-600">{m.text}</p>
          </div>
        ))}
      </section>

      <section className="mt-12 grid gap-6 rounded-2xl bg-ink-900 p-8 text-ink-100 lg:grid-cols-3">
        <div>
          <h2 className="text-xl font-bold text-white">Privacy by design</h2>
          <p className="mt-2 text-sm text-ink-300">Monitoring is limited to school-managed browsers and only runs while a class session is live.</p>
        </div>
        <ul className="space-y-2 text-sm lg:col-span-2">
          <li>✓ Students are told when their screen is shown and can see what is being reported.</li>
          <li>✓ Continuous screen recording is never stored. Only the latest thumbnail is kept, and it is deleted when the session ends.</li>
          <li>✓ A lost connection is shown as "connection lost", never counted as a rule violation.</li>
          <li>✓ Off-task alerts carry a confidence score and are only a prompt for the teacher; SwiftCipher never makes disciplinary decisions.</li>
          <li>✓ Learning data and device telemetry have separate retention periods, and schools can export or delete data.</li>
        </ul>
      </section>
    </main>
  );
}
