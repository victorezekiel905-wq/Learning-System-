import Link from "next/link";
import { cn } from "@/lib/utils";

/** The SwiftCipher mark: an ink tile with a cut "S" and a lime notch in the corner. */
export function LogoMark({ className, onDark = false }: { className?: string; onDark?: boolean }) {
  return (
    <svg viewBox="0 0 40 40" className={cn("h-8 w-8 shrink-0", className)} aria-hidden>
      <rect width="40" height="40" rx="10" fill={onDark ? "#FFFFFF" : "#151411"} />
      <path d="M26.5 13.2c-1.7-1.6-4-2.4-6.6-2.4-4.2 0-7 2.2-7 5.3 0 7.3 14.6 3.6 14.6 10.6 0 3.2-3 5.5-7.4 5.5-2.9 0-5.4-1-7.2-2.8"
            fill="none" stroke={onDark ? "#151411" : "#FFFFFF"} strokeWidth="3.6" strokeLinecap="round" />
      <rect x="29" y="4" width="7" height="7" rx="2" fill="rgb(var(--accent-500))" />
    </svg>
  );
}

export function Logo({ href = "/", compact = false, onDark = false, className }: { href?: string; compact?: boolean; onDark?: boolean; className?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2.5 no-underline", onDark ? "text-white hover:text-white" : "text-ink-900 hover:text-ink-900", className)} aria-label="SwiftCipher home">
      <LogoMark onDark={onDark} />
      {!compact && <span className="font-display text-[17px] font-extrabold tracking-tight">SwiftCipher</span>}
    </Link>
  );
}
