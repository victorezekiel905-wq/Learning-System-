import Link from "next/link";
import { Suspense } from "react";
import { SignupForm } from "@/components/auth/AuthForms";
import { AuthShell } from "@/components/auth/AuthShell";

export const metadata = { title: "Create your school" };

export default function SignupPage() {
  return (
    <AuthShell
      title="Create your school."
      intro={<>You&apos;ll be the school administrator and can invite teachers, IT staff and parents after setup. Students join with a class code. <Link href="/join">Have a code?</Link></>}
      statement={<>Built for schools where <span className="text-accent-400">focus</span> is the lesson.</>}
      points={[
        "Set up branches, classes and staff in minutes.",
        "Parents give consent once. Monitoring runs only in class.",
        "Hosted in the EU (Ireland). Export or delete your data any time."
      ]}>
      <Suspense><SignupForm mode="school" /></Suspense>
    </AuthShell>
  );
}
