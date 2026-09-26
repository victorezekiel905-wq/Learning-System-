import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(iso).toLocaleDateString();
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${Math.round(Number(value))}%`;
}

/** Split "a.com, b.com\nc.com" into a clean list. */
export function splitList(text: string): string[] {
  return text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

export function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
}

/** Only allow same-origin relative redirects. */
export function safeNext(value: string | null | undefined, fallback = "/dashboard"): string {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : fallback;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Array.from(rows.reduce((set, r) => { Object.keys(r).forEach((k) => set.add(k)); return set; }, new Set<string>()));
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    // Neutralise spreadsheet formula injection.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  // Headers too: the gradebook uses assignment titles as column names.
  return [cols.map(esc).join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

const TITLES = /^(mr|mrs|ms|miss|mx|dr|prof|sir|rev)\.?$/i;

/** "Mrs. Adaeze Nwosu" → "Adaeze": for greetings, skipping honorifics. */
export function firstName(full: string | null | undefined): string {
  return (full ?? "").split(/\s+/).find((p) => p && !TITLES.test(p)) ?? "";
}

/** Name parts without honorifics, for initials. */
export function nameParts(full: string): string[] {
  return full.split(/\s+/).filter((p) => p && !TITLES.test(p));
}

/** "morning" / "afternoon" / "evening" in the school's own time zone. */
export function dayPart(timeZone?: string | null, now = new Date()): "morning" | "afternoon" | "evening" {
  let h = now.getHours();
  try { h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: timeZone || undefined }).format(now)); } catch { /* unknown zone: server time */ }
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

/** Only web and email links from user content (never javascript:, data: or other schemes). */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.trim());
    return ["https:", "http:", "mailto:"].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}
