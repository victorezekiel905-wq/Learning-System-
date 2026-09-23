import Link from "next/link";

export function Logo({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="flex items-center gap-2 text-ink-900 no-underline" aria-label="SwiftCipher home">
      <svg viewBox="0 0 64 64" className="h-8 w-8" aria-hidden>
        <defs>
          <linearGradient id="sc-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4f46e5" />
            <stop offset="1" stopColor="#0891b2" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="14" fill="url(#sc-g)" />
        <path d="M42 20c-3-3-7-4-11-4-7 0-12 4-12 9 0 11 26 6 26 17 0 5-5 9-13 9-5 0-9-2-12-5" fill="none" stroke="#fff" strokeWidth="6" strokeLinecap="round" />
      </svg>
      {!compact && <span className="font-display text-base font-extrabold tracking-tight">Swift<span className="text-brand-600">Cipher</span></span>}
    </Link>
  );
}
