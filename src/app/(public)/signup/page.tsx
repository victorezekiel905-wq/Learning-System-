import Link from "next/link";
import { Suspense } from "react";
import { SignupForm } from "@/components/auth/AuthForms";

export const metadata = { title: "Create your school" };

export default function SignupPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <h1 className="text-2xl font-bold">Create your school workspace</h1>
      <p className="mb-6 mt-1 text-sm text-ink-500">
        You'll be the school administrator. Invite teachers, IT staff and parents after setup.
        Students join with a class code — <Link href="/join">have a code?</Link>
      </p>
      <Suspense><SignupForm mode="school" /></Suspense>
    </main>
  );
}
