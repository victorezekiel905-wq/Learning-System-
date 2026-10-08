import type { ReactNode } from "react";

/**
 * Sign-in and sign-up: the form on paper, and on large screens a dark panel
 * showing what this kind of account gets (see AuthArt), with one plain caption.
 */
export function AuthShell({ title, intro, children, art }: {
  title: string; intro: ReactNode; children: ReactNode;
  art: { art: ReactNode; title: string; text: string };
}) {
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-10 sm:px-8 sm:py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)] lg:gap-14 lg:py-16">
      <div className="mx-auto w-full max-w-[420px] lg:mx-0 lg:justify-self-end lg:pt-6">
        <h1 className="font-display text-[32px] font-bold leading-[1.08] tracking-[-0.025em] sm:text-[36px]">{title}</h1>
        <div className="mb-8 mt-3 text-[15px] leading-relaxed text-ink-600">{intro}</div>
        {children}
      </div>
      <aside className="hidden min-h-[580px] flex-col overflow-hidden rounded-[22px] bg-ink-950 text-white lg:flex" aria-label="About this account">
        <div aria-hidden className="flex flex-1 items-center justify-center px-10 py-12 text-ink-900">{art.art}</div>
        <div className="border-t border-white/10 px-10 py-7">
          <p className="text-[17px] font-semibold text-white">{art.title}</p>
          <p className="mt-1.5 max-w-md text-[14px] leading-relaxed text-ink-400">{art.text}</p>
        </div>
      </aside>
    </main>
  );
}
