import Link from "next/link";
import { Suspense } from "react";
import { SignupForm } from "@/components/auth/AuthForms";
import { AuthShell } from "@/components/auth/AuthShell";

export const metadata = { title: "Join with a code" };

export default function JoinPage() {
  return (
    <AuthShell
      title="Join with a code."
      intro={<>Students use the class code their teacher shows. Teachers, IT staff and parents use the invite code their school sent. Already have an account? <Link href="/login?next=/student/join">Sign in</Link> and enter the code there.</>}
      statement={<>Your class is <span className="text-accent-400">one code</span> away.</>}
      points={[
        "Students: the code puts you straight into your teacher's class.",
        "Parents: the code links you to your child's reports and teachers.",
        "Staff: the code adds you to your school with the right access."
      ]}>
      <Suspense><SignupForm mode="code" /></Suspense>
    </AuthShell>
  );
}
