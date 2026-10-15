"use client";
import { useEffect, useRef, useState } from "react";
import { Delete, Keyboard, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Field = HTMLInputElement | HTMLTextAreaElement;
type Mode = "abc" | "123" | "maths";

const TYPEABLE = new Set(["text", "search", "number", "tel", "url", "email", ""]);
const isField = (el: Element | null): el is Field =>
  !!el && ((el instanceof HTMLTextAreaElement && !el.readOnly && !el.disabled)
    || (el instanceof HTMLInputElement && TYPEABLE.has(el.type) && !el.readOnly && !el.disabled));

const ROWS: Record<Mode, string[][]> = {
  abc: [["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"], ["a", "s", "d", "f", "g", "h", "j", "k", "l"], ["z", "x", "c", "v", "b", "n", "m", ",", "."]],
  "123": [["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"], ["-", "/", ":", ";", "(", ")", "₦", "&", "@", "\""], ["?", "!", "'", "#", "%", "*", "+", "=", "_"]],
  maths: [["+", "−", "×", "÷", "=", "≠", "<", ">", "≤", "≥"], ["√", "π", "°", "²", "³", "½", "¼", "¾", "±", "∞"], ["(", ")", "[", "]", "%", "x", "y", "^", "."]]
};

/**
 * Types a character into the field as if the student had: through the browser's own
 * value setter and an "input" event, so React's onChange runs as usual.
 */
function insert(el: Field, text: string) {
  const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
  const next = text === "\b"
    ? (start === end ? el.value.slice(0, Math.max(0, start - 1)) + el.value.slice(end) : el.value.slice(0, start) + el.value.slice(end))
    : el.value.slice(0, start) + text + el.value.slice(end);
  if (el instanceof HTMLInputElement && el.maxLength > 0 && next.length > el.maxLength) return;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, next);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  const caret = text === "\b" ? (start === end ? Math.max(0, start - 1) : start) : start + text.length;
  try { el.setSelectionRange(caret, caret); } catch { /* number fields have no caret */ }
}

/**
 * "Keyboard" for any assessment: an on-screen keyboard (letters, numbers and maths
 * symbols) that types into the answer box last tapped inside `scope`. Handy on
 * classroom touch panels and for students who find the device keyboard hard; while
 * it's open the device's own keyboard stays down.
 */
export function KeyboardToggle({ scope }: { scope: React.RefObject<HTMLElement | null> }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("abc");
  const [shift, setShift] = useState(false);
  const target = useRef<Field | null>(null);
  const [hasTarget, setHasTarget] = useState(false);

  // Room at the bottom of the page while it's open, so nothing is hidden behind it.
  useEffect(() => {
    if (!open) return;
    const before = document.body.style.paddingBottom;
    document.body.style.paddingBottom = "18rem";
    return () => { document.body.style.paddingBottom = before; };
  }, [open]);

  // Remember the answer box last focused in this activity; keep the device keyboard down.
  useEffect(() => {
    if (!open) return;
    const root = scope.current;
    const pick = (el: Element | null) => {
      if (!isField(el) || !root?.contains(el)) return;
      if (target.current && target.current !== el) target.current.removeAttribute("inputmode");
      target.current = el;
      el.setAttribute("inputmode", "none");
      setHasTarget(true);
    };
    const onFocus = (e: FocusEvent) => pick(e.target as Element);
    document.addEventListener("focusin", onFocus);
    pick(document.activeElement);
    if (!target.current) {
      const first = root?.querySelector("input, textarea") ?? null;
      if (isField(first)) { pick(first); first.focus({ preventScroll: true }); }
    }
    return () => {
      document.removeEventListener("focusin", onFocus);
      target.current?.removeAttribute("inputmode");
    };
  }, [open, scope]);

  const press = (text: string) => {
    const el = target.current;
    if (!el || !el.isConnected) { setHasTarget(false); return; }
    if (text === "\n" && el instanceof HTMLInputElement) {
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      el.form?.requestSubmit();
      return;
    }
    insert(el, text);
    if (shift) setShift(false);
  };
  // Keys never take focus away from the answer box.
  const keep = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();
  const key = "grid h-11 min-w-0 flex-1 place-items-center rounded-lg bg-white text-lg font-semibold text-ink-900 shadow-sm ring-1 ring-ink-200 active:bg-ink-100 sm:h-12";
  const wide = "grid h-11 place-items-center rounded-lg bg-ink-200 px-3 text-sm font-semibold text-ink-800 active:bg-ink-300 sm:h-12";

  return (
    <>
      <button type="button" onPointerDown={keep} onClick={() => setOpen((v) => !v)} aria-pressed={open}
        className={cn("inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold", open ? "bg-ink-900 text-white" : "bg-ink-100 text-ink-800 hover:bg-ink-200")}
        title="On-screen keyboard">
        <Keyboard className="h-4 w-4" aria-hidden /> Keyboard
      </button>
      {open && (
        <div role="group" aria-label="On-screen keyboard" onPointerDown={keep}
          className="fixed inset-x-0 bottom-0 z-50 border-t border-ink-200 bg-ink-100/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-overlay backdrop-blur sm:px-4">
          <div className="mx-auto max-w-3xl space-y-1.5">
            <div className="flex items-center justify-between gap-2 px-1 text-xs text-ink-600">
              <span>{hasTarget ? "Typing into your answer" : "Tap an answer box first"}</span>
              <button type="button" onClick={() => setOpen(false)} className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold hover:bg-ink-200" aria-label="Close the keyboard"><X className="h-4 w-4" aria-hidden /> Close</button>
            </div>
            {ROWS[mode].map((row, i) => (
              <div key={i} className="flex gap-1 sm:gap-1.5">
                {i === 2 && mode === "abc" && <button type="button" className={cn(wide, shift && "bg-ink-900 text-white")} aria-pressed={shift} onClick={() => setShift((v) => !v)} aria-label="Capital letters">⇧</button>}
                {row.map((k) => {
                  const ch = mode === "abc" && shift ? k.toUpperCase() : k;
                  return <button key={k} type="button" className={key} onClick={() => press(ch)} aria-label={ch === "−" ? "minus" : ch}>{ch}</button>;
                })}
                {i === 2 && <button type="button" className={wide} onClick={() => press("\b")} aria-label="Delete"><Delete className="h-5 w-5" aria-hidden /></button>}
              </div>
            ))}
            <div className="flex gap-1 sm:gap-1.5">
              {(["abc", "123", "maths"] as const).filter((m) => m !== mode).map((m) => (
                <button key={m} type="button" className={wide} onClick={() => setMode(m)}>{m === "abc" ? "ABC" : m === "123" ? "123" : "Maths"}</button>
              ))}
              <button type="button" className={cn(key, "flex-[4]")} onClick={() => press(" ")} aria-label="Space">space</button>
              <button type="button" className={cn(wide, "bg-brand-600 text-white active:bg-brand-700")} onClick={() => press("\n")} aria-label="Enter">Enter</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
