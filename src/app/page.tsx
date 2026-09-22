import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-20">
      <header className="mb-16">
        <p className="text-sm font-medium text-brand-600">EduClass Fusion</p>
        <h1 className="mt-2 text-4xl font-bold tracking-tight">Learning + Classroom Control, on one canvas.</h1>
        <p className="mt-4 max-w-2xl text-slate-600">
          Build interactive lessons, run live assessments and games, then supervise every device in
          the room from a single multi-tenant workspace backed by Supabase.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href="/login" className="btn btn-primary">Sign in</Link>
          <Link href="/signup" className="btn btn-ghost">Create a school</Link>
          <Link href="/student/join" className="btn btn-ghost">Join a class</Link>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          { t: "Fusion Studio", d: "Slide editor, interactive video, activity authoring." , href: "/teacher/studio" },
          { t: "Fusion Assess", d: "MCQ, open-ended, draw, fill-in, matching, code sandbox." , href: "/teacher/assess" },
          { t: "Fusion Challenge", d: "Game quizzes with live leaderboards & streaks." , href: "/teacher/challenge" },
          { t: "Fusion Live", d: "Live presence, chat, announcements, command queue." , href: "/teacher/live" },
          { t: "Fusion Guard", d: "Device enrollment, monitoring, focus/lock controls." , href: "/teacher/guard" },
          { t: "Fusion Admin", d: "Tenant policies, audit log, subscription, feature flags." , href: "/teacher/admin" }
        ].map((c) => (
          <Link key={c.t} href={c.href} className="card p-5 transition hover:border-brand-400">
            <h3 className="text-lg font-semibold">{c.t}</h3>
            <p className="mt-1 text-sm text-slate-600">{c.d}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
