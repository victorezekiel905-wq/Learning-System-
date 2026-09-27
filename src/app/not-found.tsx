import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col bg-ink-50 px-4 sm:px-8">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center"><Logo /></div>
      <div className="mx-auto grid w-full max-w-xl flex-1 place-items-center pb-16 text-center">
        <div>
          <p className="font-display text-[96px] font-extrabold leading-none tracking-tightest text-ink-900 sm:text-[128px]" aria-hidden>
            4<span className="text-brand-600">0</span>4
          </p>
          <h1 className="mt-6 font-display text-[28px] font-extrabold leading-tight tracking-tightest sm:text-[34px]">
            Page <span className="mark">not found</span>.
          </h1>
          <p className="mx-auto mt-3 max-w-md text-[15px] text-ink-600">
            The link may be old or mistyped, or the page belongs to a different account. Nothing is wrong with your data.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/dashboard" className="btn btn-primary no-underline">Go to your dashboard</Link>
            <Link href="/" className="btn btn-secondary no-underline">SwiftCipher home</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
