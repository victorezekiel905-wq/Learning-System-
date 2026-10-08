import Link from "next/link";
import { requireRole } from "@/lib/session";
import { Alert, Empty, PageHeader } from "@/components/ui";
import { firstName } from "@/lib/utils";
import { ProgressPanel } from "./ProgressPanel";
import { MyClasses, type MyClass } from "./MyClasses";
import { Icon } from "@/components/Icon";

export const metadata = { title: "Home" };

type Home = {
  classes: { id: string; name: string; subject: string | null; teacher: string; teacher_id: string }[];
  live: { id: string; title: string; class: string; environment_active: boolean; started_at: string }[];
  games: { id: string; title: string; join_code: string; status: string; class: string }[];
  assignments: { id: string; title: string; due_at: string | null; class: string; activity_id: string | null; submitted: boolean; points_possible: number; late_allowed: boolean }[];
  feedback: { kind: string; title: string; score: number | null; out_of: number; feedback: string | null; at: string }[];
  scores: { activity: string; score: number | null; max: number | null; status: string; at: string }[];
  devices: number;
};

export default async function StudentHome() {
  const { me, sb } = await requireRole(["student"]);
  const [{ data, error }, mine] = await Promise.all([sb.rpc("student_home"), sb.rpc("my_classes")]);
  const myClasses = (mine.data as MyClass[] | null) ?? [];
  // A dropped connection shows the retry screen (error.tsx), not a crash inside the page.
  if (error || !data) throw new Error(`Couldn't load the student home page: ${error?.message ?? "no data"}`);
  const h = data as Home;

  return (
    <div className="page">
      <PageHeader title={`Hi${firstName(me.profile.full_name) ? `, ${firstName(me.profile.full_name)}` : ""}.`} subtitle="Your live lessons, challenges and progress."
        actions={<Link href="/student/join" className="btn btn-primary no-underline"><Icon name="key" className="h-4 w-4" />Join with code</Link>} />

      {me.settings?.welcome_message && <div className="mb-6 rounded-2xl border border-ink-200 bg-white px-5 py-4 text-[15px] text-ink-800"><span className="mr-2 font-semibold">From your school:</span>{me.settings.welcome_message}</div>}

      {h.live.map((s) => (
        <Link key={s.id} href={`/student/live/${s.id}`}
          className="group mb-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-ink-950 p-5 text-white no-underline hover:text-white sm:p-6">
          <span className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-1.5 py-1 text-[11px] font-bold leading-none">
              <span className="h-1.5 w-1.5 animate-pulse2 rounded-full bg-white" aria-hidden />LIVE</span>
            <span className="mt-3 block font-display text-2xl font-extrabold tracking-tight">{s.class} is live</span>
            <span className="mt-1 block text-sm text-ink-400">{s.title}</span>
          </span>
          <span className="btn btn-accent btn-lg">Join now</span>
        </Link>
      ))}
      {h.games.map((g) => (
        <Link key={g.id} href={`/student/game/${g.id}`}
          className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-accent-500 p-5 text-accent-ink no-underline hover:text-accent-ink sm:p-6">
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-[13px] font-bold"><Icon name="trophy" className="h-4 w-4" />Challenge open</span>
            <span className="mt-1 block font-display text-2xl font-extrabold tracking-tight">{g.title}</span>
            <span className="block text-sm opacity-80">{g.class}</span>
          </span>
          <span className="btn btn-ink btn-lg">Play</span>
        </Link>
      ))}
      {h.live.some((s) => s.environment_active) && h.devices > 0 && (
        <div className="mb-4"><Alert>A managed class session is active. While it runs, your teacher can see the site you're on and a low-resolution picture of your screen. <Link href="/student/device">What's shared?</Link></Alert></div>
      )}

      {myClasses.length > 0 ? <MyClasses classes={myClasses} /> : (
        <div className="mb-8"><Empty title="You're not in a class yet" action={<Link href="/student/join" className="btn btn-primary no-underline">Enter a code</Link>}>
          Your teacher adds you to your class, or gives you a class code. You can also join any live lesson with its code.
        </Empty></div>
      )}

      <ProgressPanel />
    </div>
  );
}
