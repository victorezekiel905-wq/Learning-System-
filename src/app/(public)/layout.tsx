import Link from "next/link";
import { Logo } from "@/components/Logo";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-white to-ink-50">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-5">
        <Logo />
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/join" className="btn btn-ghost no-underline">Join with a code</Link>
          <Link href="/login" className="btn btn-secondary no-underline">Sign in</Link>
        </nav>
      </header>
      <div className="flex-1">{children}</div>
      <footer className="mx-auto w-full max-w-6xl px-6 py-8 text-xs text-ink-500">
        © {new Date().getFullYear()} SwiftCipher · Device monitoring only runs on school-managed browsers during active class sessions.
        {" "}<Link href="/privacy">Privacy</Link>
      </footer>
    </div>
  );
}
