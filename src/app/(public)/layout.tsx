import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-white to-ink-50">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-2 px-4 py-4 sm:px-6 sm:py-5">
        <Logo />
        <nav className="flex shrink-0 items-center gap-1 text-sm sm:gap-2">
          <Link href="/join" className="btn btn-ghost no-underline"><span className="sm:hidden">Join</span><span className="hidden sm:inline">Join with a code</span></Link>
          <Link href="/login" className="btn btn-secondary no-underline">Sign in</Link>
        </nav>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="mx-auto w-full max-w-6xl px-4 py-8 text-xs text-ink-500 sm:px-6">
        © {new Date().getFullYear()} SwiftCipher · Device monitoring only runs on school-managed browsers during active class sessions.
        <span className="mt-2 flex flex-wrap gap-4"><Link href="/terms">Terms</Link><Link href="/privacy">Privacy</Link><Link href="/dpa">DPA</Link><Link href="/security">Security</Link></span>
      </footer>
    </div>
  );
}
