import Link from "next/link";
import { Suspense } from "react";
import { RolePicker, SignupForm } from "@/components/auth/AuthForms";
import { parseWho, type Who } from "@/lib/who";
import { AuthShell } from "@/components/auth/AuthShell";
import { AUTH_ART } from "@/components/auth/AuthArt";

export const metadata = { title: "Create an account" };

const COPY: Record<Who, { title: string; intro: React.ReactNode }> = {
  student: {
    title: "Join your class.",
    intro: <>Create your account with the class code from your teacher. Just joining a lesson today? <Link href="/join">Join without an account</Link>.</>
  },
  parent: {
    title: "Follow your child's progress.",
    intro: <>Sign up with the parent code from your child&apos;s school. More than one child there? Sign up once, then add each child with their own code. Already have an account? <Link href="/login?as=parent">Sign in</Link>.</>
  },
  staff: {
    title: "Join your school's staff.",
    intro: <>Use the invite code from your school admin. Setting up a new school instead? <Link href="/signup">Create a school</Link>.</>
  }
};

export default async function SignupPage(props: { searchParams: Promise<{ as?: string }> }) {
  const who = parseWho((await props.searchParams).as);
  if (who) {
    const c = COPY[who];
    return (
      <AuthShell title={c.title} intro={c.intro} art={AUTH_ART[who]}>
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
      intro={<>You&apos;ll be the school administrator and can invite staff after setup. Joining a school that already uses SwiftCipher? Sign up as a <Link href="/signup?as=student" className="underline">student</Link>, <Link href="/signup?as=parent" className="underline">parent</Link> or <Link href="/signup?as=staff" className="underline">staff member</Link>.</>}
      art={AUTH_ART.school}>
      <Suspense><SignupForm mode="school" /></Suspense>
    </AuthShell>
  );
}
