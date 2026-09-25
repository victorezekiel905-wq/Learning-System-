import Link from "next/link";
import { Logo } from "@/components/Logo";
import { LEGAL, phoneHref } from "@/lib/legal";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-ink-50">
      <header className="sticky top-0 z-30 border-b border-ink-200/70 bg-ink-50/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-2 px-4 sm:px-8">
          <Logo />
          <nav className="flex shrink-0 items-center gap-1 sm:gap-2" aria-label="Site">
            <Link href="/join" className="btn btn-ghost no-underline"><span className="sm:hidden">Join</span><span className="hidden sm:inline">Join with a code</span></Link>
            <Link href="/login" className="btn btn-secondary no-underline">Sign in</Link>
            <Link href="/signup" className="btn btn-ink hidden no-underline md:inline-flex">Create your school</Link>
          </nav>
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="bg-ink-950 text-ink-300">
        <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 py-14 sm:grid-cols-2 sm:px-8 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
          <div>
            <Logo onDark />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ink-400">
              The classroom platform for international schools: lessons students drive, and monitoring parents have agreed to.
            </p>
          </div>
          <FooterCol title="Product" links={[["/signup", "Create your school"], ["/join", "Join with a code"], ["/login", "Sign in"], ["/security", "Security"]]} />
          <FooterCol title="Legal" links={[["/terms", "Terms of Service"], ["/privacy", "Privacy Notice"], ["/dpa", "Data Processing Agreement"]]} />
          <div>
            <p className="text-[13px] font-semibold text-white">Talk to us</p>
            <ul className="mt-4 space-y-2.5 text-sm">
              <li><a className="text-ink-300 no-underline hover:text-white" href={`mailto:${LEGAL.infoEmail}`}>{LEGAL.infoEmail}</a></li>
              <li><a className="text-ink-300 no-underline hover:text-white" href={`mailto:${LEGAL.supportEmail}`}>{LEGAL.supportEmail}</a></li>
              <li><a className="text-ink-300 no-underline hover:text-white" href={phoneHref()}>{LEGAL.phone}</a></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-5 text-[13px] text-ink-400 sm:px-8">
            <p>© {new Date().getFullYear()} {LEGAL.entity || "SwiftCipher"}. Hosted in {LEGAL.hostingRegion.replace(/^European Union: /, "")}.</p>
            <p>Monitoring runs only during a live class, on devices the school manages.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="text-[13px] font-semibold text-white">{title}</p>
      <ul className="mt-4 space-y-2.5 text-sm">
        {links.map(([href, label]) => <li key={href}><Link href={href} className="text-ink-300 no-underline hover:text-white">{label}</Link></li>)}
      </ul>
    </div>
  );
}
