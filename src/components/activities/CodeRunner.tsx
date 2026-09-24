"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui";

export type RunResult = { stdout: string; error: string | null; ms: number; tests?: { name: string; passed: boolean; got: string }[] };

const TIMEOUT_MS = 5000;

/**
 * Runs student code in the browser, never on our servers (§3.2 sandboxed execution):
 * - JavaScript and Python: dedicated Workers (/sandbox/*.js) served with their own
 *   strict Content-Security-Policy (no access to the SwiftCipher API), terminated
 *   on timeout so an infinite loop can never freeze the page.
 * - HTML/CSS: rendered in an opaque-origin iframe (sandbox="allow-scripts") for preview.
 */
function runInWorker(script: string, message: unknown, timeoutMs: number, timeoutText: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const started = performance.now();
    let worker: Worker;
    try { worker = new Worker(script); }
    catch (e) { resolve({ stdout: "", error: `Couldn't start the code sandbox: ${String(e)}`, ms: 0 }); return; }
    const finish = (r: RunResult) => { clearTimeout(timer); worker.terminate(); resolve(r); };
    const timer = window.setTimeout(() => finish({ stdout: "", error: timeoutText, ms: timeoutMs }), timeoutMs);
    worker.onmessage = (e) => finish({ ...e.data, ms: Math.round(performance.now() - started) });
    worker.onerror = (e) => { e.preventDefault(); finish({ stdout: "", error: e.message || "The code sandbox failed to load.", ms: Math.round(performance.now() - started) }); };
    worker.postMessage(message);
  });
}

export function runJavaScript(source: string, tests: { name: string; input?: string; expected?: string }[] = []): Promise<RunResult> {
  return runInWorker("/sandbox/js-worker.js", { source, tests }, TIMEOUT_MS, `Stopped after ${TIMEOUT_MS / 1000}s (infinite loop?)`);
}

export function runPython(source: string): Promise<RunResult> {
  // The first run downloads the interpreter (~10 MB), so allow longer.
  return runInWorker("/sandbox/py-worker.js", source, TIMEOUT_MS * 4, `Stopped after ${(TIMEOUT_MS * 4) / 1000}s`);
}

export function CodeRunner({ language, value, onChange, tests, onResult, readOnly }: {
  language: "javascript" | "python" | "html";
  value: string;
  onChange?: (v: string) => void;
  tests?: { name: string; input?: string; expected?: string }[];
  onResult?: (r: RunResult) => void;
  readOnly?: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const preview = useRef<HTMLIFrameElement>(null);

  async function run() {
    setRunning(true);
    let r: RunResult;
    if (language === "html") {
      if (preview.current) preview.current.srcdoc = value;
      r = { stdout: "Preview updated.", error: null, ms: 0 };
    } else if (language === "python") {
      r = await runPython(value);
    } else {
      r = await runJavaScript(value, tests);
    }
    setResult(r);
    onResult?.(r);
    setRunning(false);
  }

  return (
    <div className="space-y-2">
      <textarea value={value} readOnly={readOnly} onChange={(e) => onChange?.(e.target.value)} spellCheck={false}
        aria-label={`${language} code`}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            e.preventDefault();
            const el = e.currentTarget, s = el.selectionStart;
            onChange?.(value.slice(0, s) + "  " + value.slice(el.selectionEnd));
            requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2; });
          }
        }}
        className="h-56 w-full rounded-lg border border-ink-300 bg-ink-900 p-3 font-mono text-sm text-emerald-100 focus:outline-none focus:ring-2 focus:ring-brand-500" />
      <div className="flex items-center gap-2">
        <Button size="sm" variant="accent" onClick={run} loading={running}>▶ Run</Button>
        <span className="text-xs text-ink-500">Runs in a sandbox on this device. {language === "python" && "The first run downloads Python (~10 MB)."}</span>
      </div>
      {language === "html" && <iframe ref={preview} title="HTML preview" sandbox="allow-scripts" className="h-56 w-full rounded-lg border border-ink-200 bg-white" />}
      {result && language !== "html" && (
        <div className="rounded-lg bg-ink-900 p-3 font-mono text-xs text-ink-100">
          {result.stdout && <pre className="whitespace-pre-wrap">{result.stdout}</pre>}
          {result.error && <pre className="whitespace-pre-wrap text-rose-300">{result.error}</pre>}
          {result.tests?.map((t) => <p key={t.name} className={t.passed ? "text-emerald-300" : "text-rose-300"}>{t.passed ? "✓" : "✗"} {t.name}{!t.passed && ` (got ${t.got})`}</p>)}
          <p className="mt-1 text-ink-400">{result.ms} ms</p>
        </div>
      )}
    </div>
  );
}
