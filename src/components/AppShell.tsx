"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LogOut, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useNetwork } from "@/lib/hooks";
import { useSignal } from "@/lib/realtime";
import type { Me, Role } from "@/lib/types";
import { ROLE_LABEL } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { useSignedUrl } from "@/lib/media";
import { paletteVars } from "@/lib/theme";
import { Logo } from "./Logo";
import { Avatar } from "./ui";
import { Icon, type IconName } from "./Icon";

/** The school's own logo and name when set (tenant branding), otherwise SwiftCipher's. */
function SchoolBrand({ logoPath, name, compact, onDark }: { logoPath?: string | null; name?: string | null; compact?: boolean; onDark?: boolean }) {
  const logo = useSignedUrl(logoPath);
  if (!logoPath && !name) return <Logo href="/dashboard" compact={compact} onDark={onDark} />;
  return (
    <Link href="/dashboard" className={cn("flex min-w-0 items-center gap-2.5 no-underline", onDark ? "text-white hover:text-white" : "text-ink-900 hover:text-ink-900")}>
      {logo ? <img src={logo} alt="" className="h-8 w-8 rounded-lg bg-white object-contain" />
        : <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-brand-600 font-display text-sm font-extrabold text-white">{(name ?? "S")[0]}</span>}
      {!compact && <span className="truncate font-display text-[16px] font-extrabold tracking-tight">{name ?? "SwiftCipher"}</span>}
    </Link>
  );
}

type Group = "Teach" | "Run" | "Assess" | "Safety" | "Learn" | "Family" | "School";
type NavItem = { href: string; label: string; short?: string; icon: IconName; roles: Role[]; exact?: boolean; group: Group };

const T: Role[] = ["teacher", "school_admin", "platform_admin"];
const A: Role[] = ["school_admin", "platform_admin"];
const IT: Role[] = ["it_admin", "school_admin", "platform_admin", "teacher"];
const EVERYONE: Role[] = ["student", "teacher", "school_admin", "it_admin", "parent", "platform_admin"];

// Blueprint §11 left navigation, filtered per role (§4), grouped by what the person is doing.
const NAV: NavItem[] = [
  { href: "/teacher", label: "Dashboard", short: "Home", icon: "home", roles: T, exact: true, group: "Teach" },
  { href: "/teacher/classes", label: "Classes", icon: "users", roles: [...T, "it_admin"], group: "Teach" },
  { href: "/teacher/lessons", label: "Lessons", icon: "slides", roles: T, group: "Teach" },
  { href: "/teacher/questions", label: "Question bank", icon: "question", roles: T, group: "Teach" },
  { href: "/teacher/media", label: "Media library", icon: "image", roles: T, group: "Teach" },
  { href: "/teacher/live", label: "Live classroom", short: "Live", icon: "broadcast", roles: T, group: "Run" },
  { href: "/teacher/challenge", label: "Challenge", icon: "trophy", roles: T, group: "Run" },
  { href: "/teacher/assignments", label: "Assignments", icon: "clipboard", roles: T, group: "Assess" },
  { href: "/teacher/review", label: "Review queue", icon: "check", roles: T, group: "Assess" },
  { href: "/teacher/insights", label: "Analytics", icon: "chart", roles: T, group: "Assess" },
  { href: "/teacher/reports", label: "Reports", icon: "file", roles: [...T, "it_admin"], group: "Assess" },
  { href: "/guard", label: "Devices", icon: "laptop", roles: IT, exact: true, group: "Safety" },
  { href: "/guard/environments", label: "Environments", icon: "shield", roles: IT, group: "Safety" },
  { href: "/student", label: "Home", icon: "home", roles: ["student"], exact: true, group: "Learn" },
  { href: "/student/join", label: "Join with code", short: "Join", icon: "key", roles: ["student"], group: "Learn" },
  { href: "/student/work", label: "My work", icon: "clipboard", roles: ["student"], group: "Learn" },
  { href: "/student/device", label: "This device", icon: "laptop", roles: ["student"], group: "Learn" },
  { href: "/parent", label: "My children", short: "Children", icon: "users", roles: ["parent"], group: "Family" },
  { href: "/messages", label: "Messages", icon: "chat", roles: ["student", "teacher", "school_admin", "platform_admin"], group: "School" },
  { href: "/admin", label: "School admin", short: "Admin", icon: "building", roles: A, group: "School" },
  { href: "/account", label: "Settings", icon: "settings", roles: EVERYONE, group: "School" }
];

// The phone/tablet tab bar: the few places each role goes every day. Everything else is under Menu.
const TABS: Record<Role, string[]> = {
  teacher: ["/teacher", "/teacher/classes", "/teacher/live", "/teacher/lessons"],
  school_admin: ["/teacher", "/teacher/classes", "/teacher/live", "/admin"],
  platform_admin: ["/teacher", "/teacher/classes", "/teacher/live", "/admin"],
  it_admin: ["/guard", "/guard/environments", "/teacher/classes", "/teacher/reports"],
  student: ["/student", "/student/join", "/student/work", "/messages"],
  parent: ["/parent", "/account"]
};

// Full-attention screens (live lesson, editors, games) hide the tab bar; Menu stays in the header.
const FOCUS = [/^\/student\/(live|game|lesson)\//, /^\/teacher\/live\/(?!new$)[^/]+/, /^\/teacher\/lessons\/[^/]+/, /^\/teacher\/challenge\/[^/]+/];

type Notification = { id: string; title: string; body: string | null; link: string | null; severity: string; read_at: string | null; created_at: string };

export default function AppShell({ me, children }: { me: Me & { profile: NonNullable<Me["profile"]> }; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const role = me.profile.role;
  const items = NAV.filter((n) => n.roles.includes(role));
  const tabs = TABS[role].map((h) => items.find((n) => n.href === h)).filter((n): n is NavItem => !!n);
  const focus = FOCUS.some((r) => r.test(pathname));
  const { quality } = useNetwork();

  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [menuOpen]);

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const s = me.settings;
  const themeVars = { ...paletteVars("brand", s?.brand_primary), ...paletteVars("accent", s?.brand_accent) } as React.CSSProperties;
  const schoolName = s?.brand_name || me.tenant?.name || "SwiftCipher";
  const isActive = (n: NavItem) => n.exact ? pathname === n.href : pathname === n.href || pathname.startsWith(n.href + "/");
  const groups = [...new Set(items.map((n) => n.group))];

  const nav = (dark: boolean) => (
    <nav className="flex flex-col gap-4" aria-label="Main">
      {me.super_admin && (
        <Link href="/super" className={cn("flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-semibold no-underline",
          dark ? "bg-accent-500 text-accent-ink hover:text-accent-ink" : "bg-ink-900 text-white hover:text-white")}>
          <Icon name="shield" className="h-4 w-4" /> Super admin
        </Link>
      )}
      {groups.map((g) => (
        <div key={g}>
          <p className={cn("mb-1 px-3 text-[12px] font-semibold", dark ? "text-ink-400" : "text-ink-500")}>{g}</p>
          <ul className="flex flex-col gap-px">
            {items.filter((n) => n.group === g).map((n) => {
              const active = isActive(n);
              return (
                <li key={n.href}>
                  <Link href={n.href} aria-current={active ? "page" : undefined}
                    className={cn("group relative flex items-center gap-3 rounded-[10px] px-3 py-[7px] text-[14px] font-medium no-underline transition-colors",
                      dark
                        ? active ? "bg-white/10 text-white hover:text-white" : "text-ink-300 hover:bg-white/5 hover:text-white"
                        : active ? "bg-ink-900 text-white hover:text-white" : "text-ink-700 hover:bg-ink-100 hover:text-ink-900")}>
                    {active && dark && <span aria-hidden className="absolute -left-3 top-1.5 bottom-1.5 w-1 rounded-r-full bg-accent-500" />}
                    <Icon name={n.icon} className={cn("h-[18px] w-[18px] shrink-0", active && dark && "text-accent-400")} />
                    {n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[256px_minmax(0,1fr)]" style={themeVars}>
      {/* Desktop: a dark rail that frames the work. */}
      <aside className="hidden bg-ink-950 text-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:flex-col">
        <div className="flex h-16 shrink-0 items-center px-5"><SchoolBrand logoPath={s?.brand_logo_path} name={s?.brand_name} onDark /></div>
        <div className="flex-1 overflow-y-auto px-3 pb-6 pt-2 [scrollbar-width:thin]">{nav(true)}</div>
        <div className="border-t border-white/10 p-3">
          <div className="flex items-center gap-3 rounded-xl px-2 py-2">
            <Avatar name={me.profile.full_name} className="h-9 w-9" />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-semibold text-white">{me.profile.full_name}</p>
              <p className="truncate text-[12px] text-ink-400">{ROLE_LABEL[role]}</p>
            </div>
            <button onClick={signOut} className="grid h-9 w-9 place-items-center rounded-lg text-ink-300 transition-colors hover:bg-white/10 hover:text-white" aria-label="Sign out" title="Sign out">
              <LogOut className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-ink-200 bg-ink-50/85 px-4 backdrop-blur-md sm:px-6 lg:h-16 lg:px-8">
          <div className="flex min-w-0 items-center gap-1 lg:hidden">
            <button className="btn btn-ghost -ml-2 h-10 w-10 px-0" onClick={() => setMenuOpen(true)} aria-label="Menu" aria-expanded={menuOpen} aria-controls="app-menu">
              <Icon name="menu" className="h-5 w-5" />
            </button>
            <SchoolBrand logoPath={s?.brand_logo_path} name={s?.brand_name} />
          </div>
          <p className="hidden min-w-0 truncate text-sm font-semibold text-ink-700 lg:block">{schoolName}</p>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {quality !== "good" && (
              <span className={cn("badge", quality === "offline" ? "bg-rose-50 text-rose-800 ring-rose-200" : "bg-amber-50 text-amber-900 ring-amber-200")} title="Connection quality">
                <Icon name={quality === "offline" ? "wifiOff" : "wifi"} className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{quality === "offline" ? "Offline: answers are saved and will sync" : "Slow connection: low-data mode"}</span>
                <span className="sm:hidden">{quality === "offline" ? "Offline" : "Slow"}</span>
              </span>
            )}
            <NotificationBell userId={me.profile.id} initialUnread={me.unread_notifications ?? 0} />
            <Link href="/account" className="hidden items-center gap-2.5 rounded-full py-1 pl-1 pr-3 no-underline transition-colors hover:bg-ink-100 sm:flex lg:hidden" aria-label="Your account">
              <Avatar name={me.profile.full_name} />
              <span className="text-sm font-semibold text-ink-900">{me.profile.full_name.split(" ").slice(-1)[0]}</span>
            </Link>
          </div>
        </header>

        <main id="main" className={cn("flex-1", !focus && "pb-24 lg:pb-0")}>{children}</main>
      </div>

      {/* Phones and tablets: a tab bar for the daily destinations. */}
      {!focus && tabs.length > 0 && (
        <nav aria-label="Quick" className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-ink-200 bg-white/95 backdrop-blur-md lg:hidden">
          <ul className="mx-auto grid max-w-xl" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
            {tabs.map((n) => {
              const active = isActive(n);
              return (
                <li key={n.href}>
                  <Link href={n.href} aria-current={active ? "page" : undefined}
                    className={cn("relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold no-underline transition-colors",
                      active ? "text-ink-900 hover:text-ink-900" : "text-ink-500 hover:text-ink-900")}>
                    <span className={cn("grid h-8 w-14 place-items-center rounded-full transition-colors", active && "bg-accent-400")}>
                      <Icon name={n.icon} className="h-5 w-5" />
                    </span>
                    {n.short ?? n.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {/* Phones and tablets: the full menu as a sheet. */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" id="app-menu">
          <button className="absolute inset-0 bg-ink-950/50" aria-label="Close menu" tabIndex={-1} onClick={() => setMenuOpen(false)} />
          <div role="dialog" aria-modal="true" aria-label="Menu"
               className="absolute inset-y-0 left-0 flex w-[min(88vw,340px)] animate-fade-in flex-col bg-ink-950 text-white shadow-overlay">
            <div className="flex h-14 items-center justify-between px-4">
              <SchoolBrand logoPath={s?.brand_logo_path} name={s?.brand_name} onDark />
              <MenuClose onClose={() => setMenuOpen(false)} />
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-6 pt-3">{nav(true)}</div>
            <div className="pb-safe border-t border-white/10 px-4 pt-3">
              <div className="flex items-center gap-3 py-1">
                <Avatar name={me.profile.full_name} className="h-9 w-9" />
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-sm font-semibold">{me.profile.full_name}</p>
                  <p className="truncate text-[12px] text-ink-400">{ROLE_LABEL[role]} · {schoolName}</p>
                </div>
              </div>
              <button onClick={signOut} className="btn mb-2 mt-3 w-full border border-white/15 text-white hover:bg-white/10 hover:text-white">
                <LogOut className="h-4 w-4" aria-hidden /> Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuClose({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <button ref={ref} onClick={onClose} className="grid h-10 w-10 place-items-center rounded-lg text-ink-300 hover:bg-white/10 hover:text-white" aria-label="Close menu">
      <X className="h-5 w-5" aria-hidden />
    </button>
  );
}

function NotificationBell({ userId, initialUnread }: { userId: string; initialUnread: number }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(initialUnread);
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);

  async function load() {
    const { data } = await createClient().from("notifications")
      .select("id,title,body,link,severity,read_at,created_at").order("created_at", { ascending: false }).limit(15);
    const rows = (data ?? []) as Notification[];
    setItems(rows);
    setUnread(rows.filter((r) => !r.read_at).length);
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
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
    <div className="relative" ref={box}>
      <button className="btn btn-ghost relative h-10 w-10 px-0" onClick={() => setOpen((v) => !v)} aria-label={`Notifications (${unread} unread)`} aria-expanded={open}>
        <Icon name="bell" className="h-5 w-5" />
        {unread > 0 && <span className="absolute right-1 top-1 min-w-[18px] rounded-full bg-rose-700 px-1 text-center text-[10px] font-bold leading-[18px] text-white ring-2 ring-ink-50">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="fixed inset-x-3 top-16 z-40 animate-fade-in overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-overlay sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <p className="font-display text-[15px] font-bold">Notifications</p>
            <button className="text-[13px] font-semibold text-brand-700 hover:text-brand-800" onClick={markAll}>Mark all read</button>
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-10 text-center text-sm text-ink-500">You&apos;re all caught up.</li>}
            {items.map((n) => (
              <li key={n.id} className="border-b border-ink-100 last:border-b-0">
                <button className={cn("flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-50", !n.read_at && "bg-brand-50/40")}
                  onClick={async () => {
                    await createClient().from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
                    setOpen(false);
                    if (n.link) router.push(n.link);
                    void load();
                  }}>
                  <span aria-hidden className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    n.severity === "critical" ? "bg-rose-600" : n.severity === "warning" ? "bg-amber-500" : !n.read_at ? "bg-brand-600" : "bg-transparent")} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-ink-900">{n.title}</span>
                    {n.body && <span className="line-clamp-2 block text-[13px] text-ink-600">{n.body}</span>}
                    <span className="mt-0.5 block text-[12px] text-ink-500">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <Link href="/notifications" className="block border-t border-ink-100 px-4 py-3 text-center text-[13px] font-semibold no-underline">See all notifications</Link>
        </div>
      )}
    </div>
  );
}
