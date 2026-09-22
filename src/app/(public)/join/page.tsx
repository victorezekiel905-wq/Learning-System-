import Link from "next/link";
import { Suspense } from "react";
import { SignupForm } from "@/components/auth/AuthForms";

export const metadata = { title: "Join with a code" };

export default function JoinPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <h1 className="text-2xl font-bold">Join with a code</h1>
      <p className="mb-6 mt-1 text-sm text-ink-500">
        Students use their class code. Teachers, IT staff and parents use the invite code their school sent them.
        Already have an account? <Link href="/login?next=/student/join">Sign in</Link> and enter the code there.
      </p>
      <Suspense><SignupForm mode="code" /></Suspense>
    </main>
  );
}
