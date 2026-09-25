"use client";
import {
  createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from "react";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn, nameParts } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "accent" | "ink";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading, className, children, disabled, type = "button", ...rest }, ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn("btn", `btn-${variant}`, size === "sm" && "btn-sm", size === "lg" && "btn-lg", className)}
      {...rest}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("h-4 w-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity=".25" strokeWidth="4" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------
export function Field({ label, hint, error, children, className, htmlFor }: {
  label?: ReactNode; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; htmlFor?: string;
}) {
  if (htmlFor || !label) {
    return (
      <div className={className}>
        {label && <label className="label" htmlFor={htmlFor}>{label}</label>}
        {children}
        {hint && !error && <p className="hint">{hint}</p>}
        {error && <p className="mt-1.5 text-[13px] font-medium text-rose-700" role="alert">{error}</p>}
      </div>
    );
  }
  // No explicit id: the whole field is the <label>, so its text names the control
  // inside it (screen readers, voice control; clicking the text focuses the input).
  return (
    <label className={cn("block", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && !error && <span className="hint block">{hint}</span>}
      {error && <span className="mt-1.5 block text-[13px] font-medium text-rose-700" role="alert">{error}</span>}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn("input", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn("input min-h-[88px]", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return <select ref={ref} className={cn("input", className)} {...rest}>{children}</select>;
});

export function Toggle({ checked, onChange, label, description, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("flex cursor-pointer items-start gap-3", disabled && "cursor-not-allowed opacity-60")}>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input id={id} type="checkbox" className="peer sr-only" checked={checked} disabled={disabled}
               onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-10 rounded-full bg-ink-300 transition-colors peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-600 peer-focus-visible:ring-offset-2" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-lift transition-transform peer-checked:translate-x-4" />
      </span>
      <span>
        <span className="block text-sm font-semibold text-ink-900">{label}</span>
        {description && <span className="mt-0.5 block text-[13px] leading-snug text-ink-500">{description}</span>}
      </span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Layout primitives
// ---------------------------------------------------------------------------
export function Card({ className, children, title, actions, pad = true }: {
  className?: string; children?: ReactNode; title?: ReactNode; actions?: ReactNode; pad?: boolean;
}) {
  return (
    <section className={cn("card", className)}>
      {(title || actions) && (
        <header className="flex min-h-[56px] flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-3 sm:px-6">
          <h2 className="font-display text-[15px] font-bold tracking-tight text-ink-900">{title}</h2>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(pad && "card-pad")}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: {
  title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 sm:mb-9">
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-ink-600">
            <span aria-hidden className="h-2 w-2 rounded-full bg-accent-500 ring-4 ring-accent-500/20" />{eyebrow}
          </p>
        )}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const BADGE_TONES = {
  gray: "bg-ink-100 text-ink-700 ring-ink-200",
  brand: "bg-brand-50 text-brand-800 ring-brand-200",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  amber: "bg-amber-50 text-amber-900 ring-amber-200",
  red: "bg-rose-50 text-rose-800 ring-rose-200",
  // the signature highlight: accent fill with its own readable text colour
  cyan: "bg-accent-400 text-accent-ink ring-accent-500",
  ink: "bg-ink-900 text-white ring-ink-900"
} as const;

export function Badge({ tone = "gray", children, className, dot }: {
  tone?: keyof typeof BADGE_TONES; children: ReactNode; className?: string; dot?: boolean;
}) {
  return (
    <span className={cn("badge", BADGE_TONES[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}

export function Stat({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: "red" | "green" }) {
  return (
    <div className="card card-pad">
      <p className="text-[13px] font-semibold text-ink-500">{label}</p>
      <p className={cn("mt-2 font-display text-[32px] font-extrabold leading-none tracking-tightest tabular-nums text-ink-900",
        tone === "red" && "text-rose-700", tone === "green" && "text-emerald-700")}>{value}</p>
      {sub && <p className="mt-2 text-[13px] text-ink-500">{sub}</p>}
    </div>
  );
}

export function Empty({ title, children, action, icon }: { title: ReactNode; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-300 bg-white/60 px-6 py-12 text-center">
      {icon && <div className="mb-4 grid h-12 w-12 place-items-center rounded-xl bg-ink-100 text-ink-700 [&_svg]:h-5 [&_svg]:w-5">{icon}</div>}
      <p className="font-display text-base font-bold text-ink-900">{title}</p>
      {children && <div className="mt-1.5 max-w-md text-sm text-ink-600">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "info", children, title }: { tone?: "info" | "warn" | "error" | "success"; children: ReactNode; title?: ReactNode }) {
  const styles = {
    info: "border-brand-200 bg-brand-50 text-brand-950",
    warn: "border-amber-300 bg-amber-50 text-amber-950",
    error: "border-rose-300 bg-rose-50 text-rose-950",
    success: "border-emerald-300 bg-emerald-50 text-emerald-950"
  }[tone];
  const Icon = { info: Info, warn: AlertTriangle, error: XCircle, success: CheckCircle2 }[tone];
  return (
    <div className={cn("flex gap-3 rounded-xl border px-4 py-3 text-sm leading-relaxed", styles)} role={tone === "error" ? "alert" : "status"}>
      <Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2.2} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className={cn(title && "mt-0.5")}>{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs (keyboard accessible)
// ---------------------------------------------------------------------------
export function Tabs<T extends string>({ tabs, value, onChange, className }: {
  tabs: { id: T; label: ReactNode; count?: number }[]; value: T; onChange: (id: T) => void; className?: string;
}) {
  return (
    <div role="tablist" className={cn("flex gap-6 overflow-x-auto border-b border-ink-200 [scrollbar-width:none]", className)}
         onKeyDown={(e) => {
           const i = tabs.findIndex((t) => t.id === value);
           if (e.key === "ArrowRight") onChange(tabs[(i + 1) % tabs.length]!.id);
           if (e.key === "ArrowLeft") onChange(tabs[(i - 1 + tabs.length) % tabs.length]!.id);
         }}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" type="button" aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1}
          onClick={() => onChange(t.id)}
          className={cn("-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 pb-3 pt-2 text-sm font-semibold transition-colors",
            t.id === value ? "border-ink-900 text-ink-900" : "border-transparent text-ink-500 hover:text-ink-900")}>
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className="min-w-[18px] rounded-full bg-rose-700 px-1.5 text-center text-[11px] font-bold leading-[18px] text-white">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal (native <dialog>: focus trap + Esc for free).
// Phones get a sheet anchored to the bottom edge; larger screens a centred dialog.
// ---------------------------------------------------------------------------
export function Modal({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose}
      className={cn("mb-0 mt-auto w-full max-w-none rounded-t-2xl p-0 text-ink-900 shadow-overlay backdrop:bg-ink-950/50",
        "sm:m-auto sm:w-[calc(100%-2rem)] sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
      {open && (
        <div className="animate-sheet-up sm:animate-fade-in">
          <header className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-4 sm:px-6">
            <h2 className="font-display text-lg font-bold tracking-tight">{title}</h2>
            <button type="button" onClick={onClose} className="btn btn-ghost -mr-2 h-9 w-9 px-0" aria-label="Close"><X className="h-4 w-4" aria-hidden /></button>
          </header>
          <div className="max-h-[70vh] overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
          {footer && <footer className="pb-safe flex flex-wrap justify-end gap-2 border-t border-ink-100 bg-ink-50/70 px-5 pt-3 sm:px-6 sm:pb-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
type Toast = { id: number; tone: "info" | "success" | "error"; text: string };
const ToastCtx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 7000 : 4000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {/* Phones and tablets: centred above the bottom tab bar. Desktop: bottom-right. */}
      <div className="pointer-events-none fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-[60] flex flex-col items-center gap-2 lg:inset-x-auto lg:bottom-6 lg:right-6 lg:w-96 lg:items-stretch" aria-live="polite">
        {toasts.map((t) => {
          const Icon = t.tone === "error" ? XCircle : t.tone === "success" ? CheckCircle2 : Info;
          return (
            <div key={t.id} className="pointer-events-auto flex w-full max-w-md animate-sheet-up items-start gap-3 rounded-xl bg-ink-900 px-4 py-3 text-sm text-white shadow-overlay">
              <Icon aria-hidden strokeWidth={2.4}
                className={cn("mt-0.5 h-4 w-4 shrink-0", t.tone === "error" ? "text-rose-300" : t.tone === "success" ? "text-accent-400" : "text-ink-300")} />
              <span className="min-w-0">{t.text}</span>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button variant="secondary" size="sm" onClick={async () => {
      await navigator.clipboard.writeText(value).catch(() => {});
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    }}>{done ? "Copied" : label}</Button>
  );
}

// A small, deliberate set of muted avatar colours (each pair passes 4.5:1).
const AVATAR_TONES: [string, string][] = [
  ["#E4E9FB", "#1C33AB"], ["#E6F4D7", "#34520F"], ["#FBE7DA", "#8A3410"], ["#EDE4F7", "#5B2A8F"],
  ["#DCF1EE", "#115E54"], ["#F7E3E7", "#8F1D3A"], ["#EEECE6", "#27261F"], ["#FDF1CC", "#6B4E05"]
];

export function Avatar({ name, className }: { name: string; className?: string }) {
  const letters = nameParts(name).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = AVATAR_TONES[h % AVATAR_TONES.length]!;
  return (
    <span aria-hidden className={cn("inline-grid h-8 w-8 shrink-0 place-items-center rounded-full font-display text-xs font-bold", className)}
          style={{ backgroundColor: bg, color: fg }}>{letters || "?"}</span>
  );
}

