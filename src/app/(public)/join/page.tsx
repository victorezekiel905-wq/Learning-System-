import Link from "next/link";
import { GuestJoin } from "@/components/auth/GuestJoin";
import { GlyphField } from "@/components/game/Celebrate";

export const metadata = { title: "Join a lesson" };

/** One way in: the code, then a name. Accounts are a quiet link underneath. */
export default async function JoinPage(props: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await props.searchParams;
  const initial = (code ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
  return (
    <main className="relative overflow-hidden px-4 py-10 sm:px-8 sm:py-16">
      <GlyphField className="hidden sm:block" opacity={0.85} />
      <div className="relative">
        <h1 className="text-center font-display text-[34px] font-extrabold leading-tight tracking-tightest sm:text-[44px]">
          Join a <span className="mark">lesson</span>.
        </h1>
        <p className="mx-auto mt-3 max-w-md text-center text-[15px] text-ink-600">
          Type the code from your teacher&apos;s screen, then your name. No account needed.
        </p>
        <div className="mt-8">
          <GuestJoin initialCode={initial} />
        </div>
        <p className="mx-auto mt-8 max-w-md text-center text-sm text-ink-600">
          Have a school account? <Link href="/login?next=/student/join" className="font-semibold">Sign in</Link> and your answers are kept.
        </p>
        <p className="mx-auto mt-1.5 max-w-md text-center text-[13px] text-ink-500">
          New, with a class code or invite? <Link href="/signup?as=student">Create your account</Link>
        </p>
      </div>
    </main>
  );
}
