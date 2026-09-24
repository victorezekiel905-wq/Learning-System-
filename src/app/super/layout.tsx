import Link from "next/link";
import { requireSuperAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: { default: "Platform", template: "%s · Platform" }, robots: { index: false } };

const NAV = [["/super", "Overview"], ["/super/schools", "Schools"], ["/super/users", "Users"], ["/super/audit", "Platform audit"], ["/super/errors", "Errors"]] as const;

export default async function SuperLayout({ children }: { children: React.ReactNode }) {
  const { me } = await requireSuperAdmin();
  return (
    <div className="min-h-screen bg-ink-50">
      <header className="bg-ink-900 text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="rounded bg-rose-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">Super admin</span>
            <span className="font-extrabold">SwiftCipher Platform</span>
          </div>
          <nav className="flex flex-wrap gap-1 text-sm">
            {NAV.map(([href, label]) => <Link key={href} href={href} className="rounded px-3 py-1.5 text-ink-200 no-underline hover:bg-white/10 hover:text-white">{label}</Link>)}
            <Link href="/dashboard" className="rounded px-3 py-1.5 text-ink-400 no-underline hover:text-white">Exit to app →</Link>
          </nav>
          <span className="text-xs text-ink-400">{me.profile?.email ?? me.email}</span>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
