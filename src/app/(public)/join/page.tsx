import Link from "next/link";
import { Suspense } from "react";
import { SignupForm } from "@/components/auth/AuthForms";
import { GuestJoin } from "@/components/auth/GuestJoin";

export const metadata = { title: "Join a lesson" };

/** Like kahoot.it or join.nearpod.com: the code, then a name. Account sign-up with a class or invite code is below. */
export default async function JoinPage(props: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await props.searchParams;
  const initial = (code ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-8 sm:py-16">
      <h1 className="text-center font-display text-[34px] font-extrabold leading-tight tracking-tightest sm:text-[44px]">
        Join a <span className="mark">lesson</span>.
      </h1>
      <p className="mx-auto mt-3 max-w-md text-center text-[15px] text-ink-600">
        Type the code from your teacher&apos;s screen, then your name. No account needed.
      </p>
      <div className="mt-8">
        <GuestJoin initialCode={initial} />
      </div>

      <div className="mx-auto mt-10 max-w-md space-y-3 text-center text-sm text-ink-600">
        <p>Have a school account? <Link href="/login?next=/student/join">Sign in</Link> first, and your answers are saved to your profile.</p>
        <details className="rounded-2xl border border-ink-200 bg-white p-4 text-left">
          <summary className="cursor-pointer font-semibold text-ink-900">Got a class code or invite from your school? Create your account</summary>
          <p className="mb-4 mt-2 text-ink-600">Students use their class code. Teachers, IT staff and parents use the invite code their school sent.</p>
          <Suspense><SignupForm mode="code" /></Suspense>
        </details>
      </div>
    </main>
  );
}
