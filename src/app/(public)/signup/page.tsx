import Link from "next/link";
import { Suspense } from "react";
import { RolePicker, SignupForm } from "@/components/auth/AuthForms";
import { parseWho, type Who } from "@/lib/who";
import { AuthShell } from "@/components/auth/AuthShell";

export const metadata = { title: "Create an account" };

const COPY: Record<Who, { title: string; intro: React.ReactNode; statement: React.ReactNode; points: string[] }> = {
  student: {
    title: "Join your class.",
    intro: <>Create your account with the class code from your teacher. Just joining a lesson today? <Link href="/join">Join without an account</Link>.</>,
    statement: <>Play the lesson. <span className="text-accent-400">See yourself</span> get better.</>,
    points: ["Answer on your phone or laptop, live with your class.", "Points, streaks and the leaderboard.", "Your progress in every subject, and what to practise next."]
  },
  parent: {
    title: "Follow your child's progress.",
    intro: <>Sign up with the parent code from your child&apos;s school. More than one child there? Sign up once, then add each child with their own code. Already have an account? <Link href="/login?as=parent">Sign in</Link>.</>,
    statement: <>Every subject. <span className="text-accent-400">Every week.</span> One place.</>,
    points: ["Lessons attended and results, by day, week, month, term and year.", "Where your child is strong, and where they need help.", "Send feedback to each subject teacher."]
  },
  staff: {
    title: "Join your school's staff.",
    intro: <>Use the invite code from your school admin. Setting up a new school instead? <Link href="/signup">Create a school</Link>.</>,
    statement: <>Every screen in the room. <span className="text-accent-400">One lesson</span> on all of them.</>,
    points: ["Design slides, teach live, and play quizzes like a game.", "See how your students are doing in your subjects.", "Reports after every lesson; feedback from parents."]
  }
};

export default async function SignupPage(props: { searchParams: Promise<{ as?: string }> }) {
  const who = parseWho((await props.searchParams).as);
  if (who) {
    const c = COPY[who];
    return (
      <AuthShell title={c.title} intro={c.intro} statement={c.statement} points={c.points}>
        <Suspense>
          <RolePicker value={who} base="/signup" />
          <SignupForm mode="code" who={who} />
        </Suspense>
      </AuthShell>
    );
  }
  return (
    <AuthShell
      title="Create your school."
      intro={<>You&apos;ll be the school administrator and can invite staff after setup. Joining a school that already uses SwiftCipher? Sign up as a <Link href="/signup?as=student">student</Link>, <Link href="/signup?as=parent">parent</Link> or <Link href="/signup?as=staff">staff member</Link>.</>}
      statement={<>Built for schools where <span className="text-accent-400">focus</span> is the lesson.</>}
      points={[
        "Set up classes and staff in minutes.",
        "Students join with a class code; parents with their child's code.",
        "Hosted in the EU (Ireland). Export or delete your data any time."
      ]}>
      <Suspense><SignupForm mode="school" /></Suspense>
    </AuthShell>
  );
}
