"use client";
import {
  createContext, forwardRef, useCallback, useContext, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes,
  type TextareaHTMLAttributes
} from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "accent";
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
  return (
    <div className={className}>
      {label && <label className="label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && !error && <p className="hint">{hint}</p>}
      {error && <p className="mt-1 text-xs text-rose-600" role="alert">{error}</p>}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn("input", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn("input min-h-[80px]", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return <select ref={ref} className={cn("input pr-8", className)} {...rest}>{children}</select>;
});

export function Toggle({ checked, onChange, label, description, disabled }: {
  checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("flex cursor-pointer items-start gap-3", disabled && "cursor-not-allowed opacity-60")}>
      <span className="relative mt-0.5 inline-flex">
        <input id={id} type="checkbox" className="peer sr-only" checked={checked} disabled={disabled}
               onChange={(e) => onChange(e.target.checked)} />
        <span className="h-5 w-9 rounded-full bg-ink-300 transition peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-500" />
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition peer-checked:translate-x-4" />
      </span>
      <span>
        <span className="block text-sm font-medium text-ink-800">{label}</span>
        {description && <span className="block text-xs text-ink-500">{description}</span>}
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
        <header className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-3">
          <h2 className="text-sm font-semibold text-ink-800">{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
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
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-wider text-brand-600">{eyebrow}</p>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const BADGE_TONES = {
  gray: "bg-ink-100 text-ink-700",
  brand: "bg-brand-50 text-brand-700",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-rose-50 text-rose-700",
  cyan: "bg-accent-50 text-accent-800"
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
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
      <p className={cn("mt-1 font-display text-2xl font-bold tabular-nums text-ink-900", tone === "red" && "text-rose-600", tone === "green" && "text-emerald-600")}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-500">{sub}</p>}
    </div>
  );
}

export function Empty({ title, children, action, icon }: { title: ReactNode; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-300 bg-white px-6 py-10 text-center">
      {icon && <div className="mb-3 text-ink-500">{icon}</div>}
      <p className="font-semibold text-ink-800">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-ink-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "info", children, title }: { tone?: "info" | "warn" | "error" | "success"; children: ReactNode; title?: ReactNode }) {
  const styles = {
    info: "border-brand-200 bg-brand-50 text-brand-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-rose-200 bg-rose-50 text-rose-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900"
  }[tone];
  return (
    <div className={cn("rounded-lg border px-4 py-3 text-sm", styles)} role={tone === "error" ? "alert" : "status"}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={cn(title && "mt-0.5")}>{children}</div>
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
    <div role="tablist" className={cn("flex gap-1 overflow-x-auto border-b border-ink-200", className)}
         onKeyDown={(e) => {
           const i = tabs.findIndex((t) => t.id === value);
           if (e.key === "ArrowRight") onChange(tabs[(i + 1) % tabs.length]!.id);
           if (e.key === "ArrowLeft") onChange(tabs[(i - 1 + tabs.length) % tabs.length]!.id);
         }}>
      {tabs.map((t) => (
        <button key={t.id} role="tab" type="button" aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1}
          onClick={() => onChange(t.id)}
          className={cn("-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition",
            t.id === value ? "border-brand-600 text-brand-700" : "border-transparent text-ink-500 hover:text-ink-800")}>
          {t.label}
          {t.count !== undefined && t.count > 0 && (
            <span className="rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Modal (native <dialog>: focus trap + Esc for free)
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
      className={cn("w-[calc(100%-2rem)] rounded-xl p-0 shadow-2xl backdrop:bg-ink-900/40", wide ? "max-w-3xl" : "max-w-lg")}>
      {open && (
        <div className="animate-fade-in">
          <header className="flex items-center justify-between border-b border-ink-100 px-5 py-3">
            <h2 className="font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Close">✕</button>
          </header>
          <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-ink-100 px-5 py-3">{footer}</footer>}
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
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={cn("pointer-events-auto animate-fade-in rounded-lg px-4 py-3 text-sm shadow-lg",
            t.tone === "error" ? "bg-rose-600 text-white" : t.tone === "success" ? "bg-emerald-600 text-white" : "bg-ink-900 text-white")}>
            {t.text}
          </div>
        ))}
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

export function Avatar({ name, className }: { name: string; className?: string }) {
  const letters = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return (
    <span aria-hidden className={cn("inline-grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white", className)}
          style={{ backgroundColor: `hsl(${h} 55% 45%)` }}>{letters || "?"}</span>
  );
}
