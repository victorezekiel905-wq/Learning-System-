"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useNetwork } from "@/lib/hooks";
import { useSignal } from "@/lib/realtime";
import type { Me, Role } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { useSignedUrl } from "@/lib/media";
import { paletteVars } from "@/lib/theme";
import { Logo } from "./Logo";

/** The school's own logo and name when set (tenant branding), otherwise SwiftCipher's. */
function SchoolBrand({ logoPath, name, compact }: { logoPath?: string | null; name?: string | null; compact?: boolean }) {
  const logo = useSignedUrl(logoPath);
  if (!logoPath && !name) return <Logo href="/dashboard" compact={compact} />;
  return (
    <Link href="/dashboard" className="flex min-w-0 items-center gap-2 text-ink-900 no-underline">
      {logo ? <img src={logo} alt="" className="h-8 w-8 rounded-lg object-contain" />
        : <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-black text-white">{(name ?? "S")[0]}</span>}
      {!compact && <span className="truncate font-display text-base font-extrabold tracking-tight">{name ?? "SwiftCipher"}</span>}
    </Link>
  );
}
import { Avatar } from "./ui";
import { Icon, type IconName } from "./Icon";

type NavItem = { href: string; label: string; icon: IconName; roles: Role[]; exact?: boolean };

const T: Role[] = ["teacher", "school_admin", "platform_admin"];
const A: Role[] = ["school_admin", "platform_admin"];
const IT: Role[] = ["it_admin", "school_admin", "platform_admin", "teacher"];

// Blueprint §11 left navigation, filtered per role (§4).
const NAV: NavItem[] = [
  { href: "/teacher", label: "Dashboard", icon: "home", roles: T, exact: true },
  { href: "/teacher/classes", label: "Classes", icon: "users", roles: [...T, "it_admin"] },
  { href: "/teacher/lessons", label: "Lessons", icon: "slides", roles: T },
  { href: "/teacher/questions", label: "Question bank", icon: "question", roles: T },
  { href: "/teacher/media", label: "Media library", icon: "image", roles: T },
  { href: "/teacher/assignments", label: "Assignments", icon: "clipboard", roles: T },
  { href: "/teacher/review", label: "Review queue", icon: "check", roles: T },
  { href: "/teacher/live", label: "Live classroom", icon: "broadcast", roles: T },
  { href: "/teacher/challenge", label: "Challenge", icon: "trophy", roles: T },
  { href: "/teacher/insights", label: "Analytics", icon: "chart", roles: T },
  { href: "/guard", label: "Devices", icon: "laptop", roles: IT, exact: true },
  { href: "/guard/environments", label: "Environments", icon: "shield", roles: IT },
  { href: "/teacher/reports", label: "Reports", icon: "file", roles: [...T, "it_admin"] },
  { href: "/student", label: "Home", icon: "home", roles: ["student"], exact: true },
  { href: "/student/join", label: "Join with code", icon: "key", roles: ["student"] },
  { href: "/student/work", label: "My work", icon: "clipboard", roles: ["student"] },
  { href: "/student/device", label: "This device", icon: "laptop", roles: ["student"] },
  { href: "/parent", label: "My children", icon: "users", roles: ["parent"] },
  { href: "/messages", label: "Messages", icon: "chat", roles: ["student", "teacher", "school_admin", "platform_admin"] },
  { href: "/admin", label: "School admin", icon: "building", roles: A },
  { href: "/account", label: "Settings", icon: "settings", roles: ["student", "teacher", "school_admin", "it_admin", "parent", "platform_admin"] }
];

type Notification = { id: string; title: string; body: string | null; link: string | null; severity: string; read_at: string | null; created_at: string };

export default function AppShell({ me, children }: { me: Me & { profile: NonNullable<Me["profile"]> }; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const role = me.profile.role;
  const items = NAV.filter((n) => n.roles.includes(role));
  const { quality } = useNetwork();

  useEffect(() => setMobileOpen(false), [pathname]);

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const s = me.settings;
  const themeVars = { ...paletteVars("brand", s?.brand_primary), ...paletteVars("accent", s?.brand_accent) } as React.CSSProperties;
  const schoolName = s?.brand_name || me.tenant?.name || "SwiftCipher";

  const nav = (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {me.super_admin && (
        <Link href="/super" className="mb-2 flex items-center gap-2.5 rounded-lg bg-ink-900 px-3 py-2 text-sm font-semibold text-white no-underline">
          <Icon name="shield" className="h-4 w-4" /> Super admin
        </Link>
      )}
      {items.map((n) => {
        const active = n.exact ? pathname === n.href : pathname === n.href || pathname.startsWith(n.href + "/");
        return (
          <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
            className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium no-underline transition",
              active ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900")}>
            <Icon name={n.icon} className="h-4 w-4 shrink-0" />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]" style={themeVars}>
      <aside className="hidden border-r border-ink-200 bg-white lg:flex lg:flex-col">
        <div className="flex h-14 items-center border-b border-ink-100 px-4"><SchoolBrand logoPath={s?.brand_logo_path} name={s?.brand_name} /></div>
        <div className="flex-1 overflow-y-auto p-3">{nav}</div>
        <div className="border-t border-ink-100 p-3 text-xs text-ink-500">
          <p className="truncate font-medium text-ink-700">{me.tenant?.name}</p>
          <p>{me.plan?.name} plan</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-ink-200 bg-white/90 px-4 backdrop-blur">
          <div className="flex items-center gap-2 lg:hidden">
            <button className="btn btn-ghost btn-sm" onClick={() => setMobileOpen((v) => !v)} aria-label="Menu" aria-expanded={mobileOpen}>
              <Icon name="menu" className="h-5 w-5" />
            </button>
            <SchoolBrand logoPath={s?.brand_logo_path} name={s?.brand_name} compact />
          </div>
          <div className="hidden text-sm text-ink-500 lg:block">{schoolName}</div>
          <div className="flex items-center gap-3">
            {quality !== "good" && (
              <span className={cn("badge", quality === "offline" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-800")} title="Connection quality">
                {quality === "offline" ? "Offline — answers are saved and will sync" : "Slow connection — low-data mode"}
              </span>
            )}
            <NotificationBell userId={me.profile.id} initialUnread={me.unread_notifications ?? 0} />
            <div className="hidden items-center gap-2 sm:flex">
              <Avatar name={me.profile.full_name} />
              <div className="leading-tight">
                <p className="text-sm font-medium text-ink-800">{me.profile.full_name}</p>
                <p className="text-[11px] text-ink-500">{ROLE_LABEL[role]}</p>
              </div>
            </div>
            <button onClick={signOut} className="btn btn-ghost btn-sm">Sign out</button>
          </div>
        </header>
        {mobileOpen && <div className="border-b border-ink-200 bg-white p-3 lg:hidden">{nav}</div>}
        <main id="main" className="flex-1">{children}</main>
      </div>
    </div>
  );
}

function NotificationBell({ userId, initialUnread }: { userId: string; initialUnread: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(initialUnread);
  const router = useRouter();

  async function load() {
    const { data } = await createClient().from("notifications")
      .select("id,title,body,link,severity,read_at,created_at").order("created_at", { ascending: false }).limit(15);
    const rows = (data ?? []) as Notification[];
    setItems(rows);
    setUnread(rows.filter((r) => !r.read_at).length);
  }

  useEffect(() => { void load(); }, []);
  useSignal(`user:${userId}`, ["notification"], () => {
    void load();
    // Browser notification for critical alerts when the tab is in the background (§3.6).
    if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
      new Notification("SwiftCipher", { body: "You have a new alert." });
    }
  });

  async function markAll() {
    await createClient().from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
    void load();
  }

  return (
    <div className="relative">
      <button className="btn btn-ghost btn-sm relative" onClick={() => setOpen((v) => !v)} aria-label={`Notifications (${unread} unread)`}>
        <Icon name="bell" className="h-5 w-5" />
        {unread > 0 && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 animate-fade-in rounded-xl border border-ink-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            <button className="text-xs font-medium text-brand-700" onClick={markAll}>Mark all read</button>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-ink-500">You're all caught up.</li>}
            {items.map((n) => (
              <li key={n.id}>
                <button className={cn("block w-full px-4 py-2.5 text-left hover:bg-ink-50", !n.read_at && "bg-brand-50/50")}
                  onClick={async () => {
                    await createClient().from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
                    setOpen(false);
                    if (n.link) router.push(n.link);
                    void load();
                  }}>
                  <p className="flex items-center gap-1.5 text-sm font-medium text-ink-800">
                    {n.severity !== "info" && <span className={cn("h-2 w-2 rounded-full", n.severity === "critical" ? "bg-rose-600" : "bg-amber-500")} />}
                    {n.title}
                  </p>
                  {n.body && <p className="line-clamp-2 text-xs text-ink-500">{n.body}</p>}
                  <p className="mt-0.5 text-[11px] text-ink-500">{timeAgo(n.created_at)}</p>
                </button>
              </li>
            ))}
          </ul>
          <Link href="/notifications" className="block border-t border-ink-100 px-4 py-2 text-center text-xs font-medium">See all</Link>
        </div>
      )}
    </div>
  );
}
