import { Suspense } from "react";
import { LoginForm } from "@/components/auth/AuthForms";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-10">
      <h1 className="text-2xl font-bold">Welcome back</h1>
      <p className="mb-6 mt-1 text-sm text-ink-500">Sign in to your school workspace.</p>
      <Suspense><LoginForm /></Suspense>
    </main>
  );
}
