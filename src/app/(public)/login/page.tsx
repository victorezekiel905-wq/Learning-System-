import { Suspense } from "react";
import { LoginForm } from "@/components/auth/AuthForms";
import { AuthShell } from "@/components/auth/AuthShell";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <AuthShell
      title="Welcome back."
      intro="Sign in to your school workspace."
      statement={<>Every screen in the room. <span className="text-accent-400">One lesson</span> on all of them.</>}
      points={[
        "Tap any student's screen to see it. Only you do.",
        "Know within two seconds when someone leaves the lesson.",
        "Lessons, games and levels your students choose themselves."
      ]}>
      <Suspense><LoginForm /></Suspense>
    </AuthShell>
  );
}
