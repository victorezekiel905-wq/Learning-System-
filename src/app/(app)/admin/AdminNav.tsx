"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  ["/admin", "Overview"], ["/admin/users", "People"], ["/admin/settings", "Settings & privacy"], ["/admin/audit", "Audit log"], ["/admin/billing", "Plan & billing"]
] as const;

/** School admin sections, marked the same way as the app's other tabs. */
export function AdminNav() {
  const path = usePathname();
  return (
    <nav className="border-b border-ink-200 bg-ink-50/85" aria-label="School admin">
      <ul className="mx-auto flex max-w-7xl gap-6 overflow-x-auto px-4 [scrollbar-width:none] sm:px-8">
        {TABS.map(([href, label]) => {
          const active = href === "/admin" ? path === href : path === href || path.startsWith(href + "/");
          return (
            <li key={href}>
              <Link href={href} aria-current={active ? "page" : undefined}
                className={cn("-mb-px block whitespace-nowrap border-b-2 pb-3 pt-3.5 text-sm font-semibold no-underline transition-colors",
                  active ? "border-ink-900 text-ink-900 hover:text-ink-900" : "border-transparent text-ink-500 hover:text-ink-900")}>{label}</Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
