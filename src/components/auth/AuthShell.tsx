import type { ReactNode } from "react";
import { Check } from "lucide-react";

/** Sign-in and sign-up: the form on paper, and on large screens a dark panel that says what SwiftCipher is for. */
export function AuthShell({ title, intro, children, statement, points }: {
  title: string; intro: ReactNode; children: ReactNode; statement: ReactNode; points: string[];
}) {
  return (
    <main className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-10 sm:px-8 sm:py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16 lg:py-16">
      <div className="mx-auto w-full max-w-[440px] lg:mx-0 lg:justify-self-end">
        <h1 className="font-display text-[34px] font-extrabold leading-[1.05] tracking-tightest sm:text-[40px]">{title}</h1>
        <div className="mb-8 mt-3 text-[15px] leading-relaxed text-ink-600">{intro}</div>
        {children}
      </div>
      <aside className="relative hidden overflow-hidden rounded-3xl bg-ink-950 p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-12" aria-label="About SwiftCipher">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-accent-500/15 blur-3xl" />
        <p className="relative font-display text-[40px] font-extrabold leading-[1.02] tracking-tightest xl:text-[48px]">{statement}</p>
        <ul className="relative mt-10 space-y-3.5">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-3 text-[15px] leading-snug text-ink-200">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-500 text-accent-ink"><Check className="h-3 w-3" strokeWidth={3.2} aria-hidden /></span>
              {p}
            </li>
          ))}
        </ul>
      </aside>
    </main>
  );
}
