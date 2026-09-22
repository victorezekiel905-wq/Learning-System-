"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui";

export type RunResult = { stdout: string; error: string | null; ms: number; tests?: { name: string; passed: boolean; got: string }[] };

const TIMEOUT_MS = 5000;
const MAX_OUTPUT = 20_000;

/**
 * Runs student code in the browser, never on our servers (§3.2 sandboxed execution):
 * - JavaScript: an opaque-origin iframe (sandbox="allow-scripts", no same-origin) with a hard timeout.
 * - HTML/CSS: rendered in the same kind of sandbox for preview.
 * - Python: Pyodide inside a dedicated Worker that is terminated on timeout.
 */
export function runJavaScript(source: string, tests: { name: string; input?: string; expected?: string }[] = []): Promise<RunResult> {
  return new Promise((resolve) => {
    const started = performance.now();
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.style.display = "none";
    const token = crypto.randomUUID();
    const harness = `<script>
      const out=[];const log=(...a)=>{out.push(a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '))};
      console.log=log;console.error=log;console.warn=log;
      const tests=${JSON.stringify(tests)};const results=[];let error=null;
      try{ (new Function(${JSON.stringify(source)}))();
        for(const t of tests){ try{ const got=String((new Function('return ('+(t.input||'undefined')+')'))()); results.push({name:t.name,passed:got===String(t.expected),got}); }catch(e){ results.push({name:t.name,passed:false,got:String(e)}); } }
      }catch(e){ error=String(e&&e.stack||e); }
      parent.postMessage({token:${JSON.stringify(token)},stdout:out.join('\\n').slice(0,${MAX_OUTPUT}),error,tests:results},'*');
    <\/script>`;
    const done = (r: RunResult) => { window.removeEventListener("message", onMsg); clearTimeout(timer); frame.remove(); resolve(r); };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow || e.data?.token !== token) return;
      done({ stdout: e.data.stdout, error: e.data.error, tests: e.data.tests, ms: Math.round(performance.now() - started) });
    };
    const timer = window.setTimeout(() => done({ stdout: "", error: `Stopped after ${TIMEOUT_MS / 1000}s (infinite loop?)`, ms: TIMEOUT_MS }), TIMEOUT_MS);
    window.addEventListener("message", onMsg);
    frame.srcdoc = harness;
    document.body.appendChild(frame);
  });
}

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.2/full/";

export function runPython(source: string): Promise<RunResult> {
  return new Promise((resolve) => {
    const started = performance.now();
    const worker = new Worker(URL.createObjectURL(new Blob([`
      importScripts('${PYODIDE}pyodide.js');
      onmessage = async (e) => {
        try {
          const py = await loadPyodide({ indexURL: '${PYODIDE}' });
          let out = '';
          py.setStdout({ batched: (s) => { out += s + '\\n'; } });
          py.setStderr({ batched: (s) => { out += s + '\\n'; } });
          await py.runPythonAsync(e.data);
          postMessage({ stdout: out.slice(0, ${MAX_OUTPUT}), error: null });
        } catch (err) { postMessage({ stdout: '', error: String(err) }); }
      };`], { type: "text/javascript" })));
    const timer = window.setTimeout(() => {
      worker.terminate();
      resolve({ stdout: "", error: `Stopped after ${(TIMEOUT_MS * 4) / 1000}s`, ms: TIMEOUT_MS * 4 });
    }, TIMEOUT_MS * 4); // first run downloads the interpreter
    worker.onmessage = (e) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ ...e.data, ms: Math.round(performance.now() - started) });
    };
    worker.postMessage(source);
  });
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
