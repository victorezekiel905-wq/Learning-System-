import { Suspense } from "react";
import { LoginForm, RolePicker } from "@/components/auth/AuthForms";
import { parseWho, type Who } from "@/lib/who";
import { AuthShell } from "@/components/auth/AuthShell";

export const metadata = { title: "Sign in" };

const COPY: Record<Who, { intro: string; statement: React.ReactNode; points: string[] }> = {
  student: {
    intro: "Sign in to join your lessons and see how you're doing.",
    statement: <>Play the lesson. <span className="text-accent-400">See yourself</span> get better.</>,
    points: ["Answer on your phone or laptop, live with your class.", "Points, streaks and the leaderboard.", "Your progress in every subject, and what to practise next."]
  },
  parent: {
    intro: "See how your child is doing in every subject.",
    statement: <>Every subject. <span className="text-accent-400">Every week.</span> One place.</>,
    points: ["Lessons attended and results, by day, week, month, term and year.", "Where your child is strong, and where they need help.", "Send feedback to each subject teacher. All your children on one dashboard."]
  },
  staff: {
    intro: "For teachers and school staff.",
    statement: <>Every screen in the room. <span className="text-accent-400">One lesson</span> on all of them.</>,
    points: ["Design slides, teach live, and play quizzes like a game.", "See how your students are doing in your subjects.", "Reports after every lesson; feedback from parents."]
  }
};

export default async function LoginPage(props: { searchParams: Promise<{ as?: string }> }) {
  const who = parseWho((await props.searchParams).as) ?? "student";
  const c = COPY[who];
  return (
    <AuthShell title="Welcome back." intro={c.intro} statement={c.statement} points={c.points}>
      <Suspense>
        <RolePicker value={who} base="/login" />
        <LoginForm who={who} />
      </Suspense>
    </AuthShell>
  );
}
