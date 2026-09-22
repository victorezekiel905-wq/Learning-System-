import Link from "next/link";
import { requireRole, ADMINS } from "@/lib/session";

const TABS = [
  ["/admin", "Overview"], ["/admin/users", "People"], ["/admin/settings", "Settings & privacy"], ["/admin/audit", "Audit log"], ["/admin/billing", "Plan & billing"]
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole(ADMINS);
  return (
    <div>
      <nav className="flex gap-1 overflow-x-auto border-b border-ink-200 bg-white px-4" aria-label="Admin">
        {TABS.map(([href, label]) => <Link key={href} href={href} className="whitespace-nowrap px-3 py-2.5 text-sm font-medium text-ink-600 no-underline hover:text-brand-700">{label}</Link>)}
      </nav>
      {children}
    </div>
  );
}
