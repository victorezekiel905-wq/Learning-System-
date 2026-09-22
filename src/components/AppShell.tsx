"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Profile = { id: string; tenant_id: string; email: string; full_name: string; role: string } | null;

const LINKS: { href: string; label: string; roles: string[] }[] = [
  { href: "/dashboard", label: "Dashboard", roles: ["teacher", "school_admin", "it_admin", "platform_admin", "student"] },
  { href: "/teacher/studio", label: "Studio", roles: ["teacher", "school_admin"] },
  { href: "/teacher/assess", label: "Assess", roles: ["teacher", "school_admin"] },
  { href: "/teacher/challenge", label: "Challenge", roles: ["teacher", "school_admin"] },
  { href: "/teacher/live", label: "Live", roles: ["teacher", "school_admin"] },
  { href: "/teacher/guard", label: "Guard", roles: ["teacher", "school_admin", "it_admin"] },
  { href: "/teacher/classes", label: "Classes", roles: ["teacher", "school_admin", "it_admin"] },
  { href: "/teacher/insights", label: "Insights", roles: ["teacher", "school_admin", "it_admin"] },
  { href: "/teacher/reports", label: "Reports", roles: ["teacher", "school_admin", "it_admin"] },
  { href: "/teacher/admin", label: "Admin", roles: ["teacher", "school_admin", "it_admin", "platform_admin"] },
  { href: "/teacher/billing", label: "Billing", roles: ["teacher", "school_admin", "it_admin"] }
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [profile, setProfile] = useState<Profile>(null);
  const bare = pathname === "/login" || pathname === "/signup" || pathname === "/student/join";

  useEffect(() => {
    fetch("/api/me").then(r => r.json()).then((j: { profile: Profile }) => {
      setProfile(j.profile);
      if (j.profile && pathname === "/") router.replace("/dashboard");
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (bare) return <>{children}</>;

  const role = profile?.role ?? "student";
  const links = LINKS.filter(l => l.roles.includes(role));

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2.5">
          <Link href="/dashboard" className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-violet-600 text-sm font-black text-white">E</span>
            <span className="text-sm font-bold">EduClass<span className="text-brand-600"> Fusion</span></span>
          </Link>
          <nav className="hidden items-center gap-1 overflow-x-auto lg:flex">
            {links.map(l => (
              <Link key={l.href} href={l.href}
                className={"whitespace-nowrap rounded-md px-3 py-1.5 text-sm " +
                  (pathname.startsWith(l.href) ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-100")}>
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            {profile && (
              <span className="hidden text-xs text-slate-500 sm:block">
                {profile.full_name} <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] uppercase">{role.replace("_", " ")}</span>
              </span>
            )}
            <button onClick={signOut} className="btn btn-ghost text-xs">Sign out</button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t border-slate-100 px-4 py-1.5 lg:hidden">
          {links.map(l => (
            <Link key={l.href} href={l.href} className="whitespace-nowrap rounded-md px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100">{l.label}</Link>
          ))}
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
