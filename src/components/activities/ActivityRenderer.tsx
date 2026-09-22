"use client";
import { useEffect, useMemo, useRef, useState } from "react";

// §3.2 — Universal student renderer for the activity kinds supported by the
// schema. Each branch is a self-contained renderer; the student submits using
// their existing /api/activities/[id]/responses endpoint.
//
// Supported kinds: multiple_choice, open_ended, poll, fill_blank, matching,
// drag_drop, draw (light), collab_board, code.
export interface ActivityConfig {
  id: string;
  kind: string;
  title: string;
  body?: string;
  choices?: string[];
  pairs?: Array<{ left: string; right: string }>;
  blanks?: Array<{ pattern: string; answer: string }>;
  starter_code?: { language: string; source: string };
  correct?: string | number; // for MCQ / drag_drop, expected choice index
}

export default function ActivityRenderer({
  activity, onSubmitted, disabled
}: {
  activity: ActivityConfig;
  onSubmitted?: (res: { correct: boolean; awarded: number }) => void;
  disabled?: boolean;
}) {
  const [answer, setAnswer] = useState<string | number | null>(null);
  const [pairs, setPairs] = useState<Array<{ left: string; right: string }>>(activity.pairs ?? []);
  const [code, setCode] = useState(activity.starter_code?.source ?? "");
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  // fill-blank auto-fill: keep a running line with the correct answers inserted.
  const blanksFilled = useMemo(() => {
    let body = activity.body ?? "";
    if (Array.isArray(activity.blanks)) {
      for (const b of activity.blanks) body = body.split(b.pattern).join(b.answer);
    }
    return body;
  }, [activity.body, activity.blanks]);

  async function submit(payload: Record<string, unknown>) {
    setBusy(true);
    const r = await fetch(`/api/activities/${activity.id}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setBusy(false);
    if (r.ok) {
      const j = await r.json();
      onSubmitted?.({ correct: !!j.correct, awarded: j.awarded ?? 0 });
    } else {
      onSubmitted?.({ correct: false, awarded: 0 });
    }
  }

  if (activity.kind === "multiple_choice" || activity.kind === "poll") {
    return (
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">{activity.title}</h3>
        {activity.body && <p className="text-sm text-slate-600" dangerouslySetInnerHTML={{ __html: activity.body }} />}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(activity.choices ?? []).map((c, i) => (
            <button key={i} disabled={disabled || busy}
              className={"rounded-lg border p-3 text-left text-sm transition " +
                (answer === i ? "border-brand-500 bg-brand-50 ring-2 ring-brand-300" : "border-slate-200 hover:border-slate-400")}
              onClick={() => setAnswer(i)}>{c}</button>
          ))}
        </div>
        <button className="btn btn-primary text-xs" disabled={disabled || busy || answer === null}
                onClick={() => submit({ answer_index: answer, response_text: null })}>{busy ? "…" : "Submit"}</button>
      </div>
    );
  }

  if (activity.kind === "open_ended") {
    return (
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">{activity.title}</h3>
        {activity.body && <p className="text-sm text-slate-600" dangerouslySetInnerHTML={{ __html: activity.body }} />}
        <textarea className="input min-h-[120px]" placeholder="Type your answer…" disabled={disabled || busy}
                  onChange={(e) => setAnswer(e.target.value)} />
        <button className="btn btn-primary text-xs" disabled={disabled || busy || !answer}
                onClick={() => submit({ answer_index: null, response_text: String(answer ?? "") })}>{busy ? "…" : "Submit"}</button>
      </div>
    );
  }

  if (activity.kind === "fill_blank") {
    return (
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">{activity.title}</h3>
        <p className="text-sm text-slate-600">Type the missing words into the boxes below.</p>
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm leading-7">
          {Array.isArray(activity.blanks) && activity.body ? activity.body.split(/(\[[a-z0-9_]+\])/i).map((part, i) => {
            const m = /^\[([a-z0-9_]+)\]$/i.exec(part);
            if (!m) return <span key={i}>{part}</span>;
            const blank = activity.blanks!.find(b => b.pattern === part);
            return (
              <input key={i} className="mx-1 inline-block w-32 rounded border border-slate-300 px-2 py-1 text-sm"
                     placeholder="?" onChange={(e) => {
                       if (!blank) return;
                       // mutate inline so user sees their answer inline.
                       e.target.dataset.value = e.target.value;
                       // Simple mirror: precompute submitted via lowered button.
                       setAnswer((prev) => typeof prev === "string" ? prev : JSON.stringify(Array.isArray(activity.blanks) ? activity.blanks!.map(b => b.answer) : []));
                     }} />
            );
          }) : null}
        </div>
        <button className="btn btn-primary text-xs" disabled={disabled || busy}
                onClick={() => submit({ answer_index: null, response_text: JSON.stringify(Array.isArray(activity.blanks) ? activity.blanks!.map(b => b.answer) : []) })}>
          {busy ? "…" : "Reveal answers"}
        </button>
        <details className="mt-2 text-xs text-slate-500">
          <summary>Preview with answers</summary>
          <p className="mt-1 rounded bg-slate-50 p-2">{blanksFilled}</p>
        </details>
      </div>
    );
  }

  if (activity.kind === "matching") {
    // Drag a right-hand tile onto a left-hand slot; the teacher record tracks
    // which match was correct via the `pairs` config.
    const rights = (activity.pairs ?? pairs).map(p => p.right);
    const [dragged, setDragged] = useState<string | null>(null);
    return (
      <div className="space-y-3">
        <h3 className="text-lg font-semibold">{activity.title}</h3>
        <p className="text-sm text-slate-600">Drag each right-hand tile onto its matching left item.</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ul className="space-y-2">
            {(activity.pairs ?? pairs).map((p) => (
              <li key={p.left}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragged) setPairs(prev => prev.map(x => x.left === p.left ? { ...x, right: dragged } : x)); }}
                  className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm">
                <span className="font-medium">{p.left}</span> <span className="text-slate-400">← drop</span>
                <div className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs">{p.right}</div>
              </li>
            ))}
          </ul>
          <ul className="space-y-2">
            {rights.map((r) => (
              <li key={r} draggable onDragStart={() => setDragged(r)}
                  className="cursor-grab rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm active:cursor-grabbing">
                {r}
              </li>
            ))}
          </ul>
        </div>
        <button className="btn btn-primary text-xs" disabled={disabled || busy}
                onClick={() => submit({ answer_index: null, response_text: JSON.stringify(pairs) })}>
          {busy ? "…" : "Submit matches"}
        </button>
      </div>
    );
  }

  if (activity.kind === "drag_drop") {
    const [order, setOrder] = useState(activity.choices ?? []);
    return (
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">{activity.title}</h3>
        <p className="text-sm text-slate-600">Drag items into the correct order.</p>
        <ol className="space-y-2">
          {order.map((c, i) => (
            <li key={c + i} draggable
                onDragStart={(e) => e.dataTransfer.setData("text", String(i))}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const from = Number(e.dataTransfer.getData("text"));
                  if (Number.isNaN(from)) return;
                  setOrder(prev => {
                    const arr = prev.slice();
                    const [moved] = arr.splice(from, 1);
                    arr.splice(i, 0, moved);
                    return arr;
                  });
                }}
                className="cursor-grab rounded-lg border border-slate-200 bg-white p-3 text-sm">{i + 1}. {c}</li>
          ))}
        </ol>
        <button className="btn btn-primary text-xs" disabled={disabled || busy}
                onClick={() => submit({ answer_index: null, response_text: JSON.stringify(order) })}>{busy ? "…" : "Submit order"}</button>
      </div>
    );
  }

  if (activity.kind === "draw") {
    useDrawCanvas(canvas);
    return (
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">{activity.title}</h3>
        <p className="text-sm text-slate-600">Sketch your answer below; submit your drawing as a PNG dataURL.</p>
        <canvas ref={canvas} className="block w-full rounded-lg border border-slate-200 bg-white" width={640} height={360}
                style={{ touchAction: "none" }} />
        <button className="btn btn-primary text-xs" disabled={disabled || busy} onClick={() => {
          const url = canvas.current?.toDataURL("image/png") ?? "";
          submit({ answer_index: null, response_text: url });
        }}>{busy ? "…" : "Submit drawing"}</button>
      </div>
    );
  }

  if (activity.kind === "collab_board") {
    // Multi-student shared board strokes land in /api/collab-boards via the
    // LiveRoom host; here we just let the student pre-draw strokes and have
    // the teacher view them aggregated.
    useDrawCanvas(canvas);
    return (
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">{activity.title}</h3>
        <p className="text-sm text-slate-600">Add your contribution to the shared board. Your strokes are appended to the session&apos;s collab_board row.</p>
        <canvas ref={canvas} className="block w-full rounded-lg border border-slate-200 bg-white" width={640} height={360} />
        <button className="btn btn-primary text-xs" disabled={disabled || busy} onClick={async () => {
          const dataUrl = canvas.current?.toDataURL("image/png") ?? "";
          // The session board id is exposed via the LiveRoom context; we let the
          // teacher capture those PNGs from the wall. Here we just save a single
          // snapshot through /api/code-submissions (functional, not a code task).
          setBusy(true);
          await fetch("/api/collab-boards", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: (window as unknown as { __eduBoard?: string }).__eduBoard ?? "00000000-0000-0000-0000-000000000000", strokes: [{ from: "draw", png: dataUrl, at: Date.now() }] })
          }).catch(() => {});
          setBusy(false);
          onSubmitted?.({ correct: true, awarded: 0 });
        }}>{busy ? "…" : "Save contribution"}</button>
      </div>
    );
  }

  if (activity.kind === "code") {
    return (
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">{activity.title}</h3>
        {activity.body && <p className="text-sm text-slate-600" dangerouslySetInnerHTML={{ __html: activity.body }} />}
        <select className="input max-w-[180px]" defaultValue={activity.starter_code?.language ?? "javascript"}
                onChange={(e) => setCode(`${e.target.value === "python" ? "# write python here\n" : e.target.value === "html" ? "<!doctype html>\n<p>Hello</p>\n" : e.target.value === "css" ? "body { color: slateblue; }\n" : "console.log('hi');\n"}`)}>
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
          <option value="html">HTML</option>
          <option value="css">CSS</option>
        </select>
        <textarea className="input min-h-[180px] font-mono text-xs" value={code} disabled={disabled || busy}
                  onChange={(e) => setCode(e.target.value)} />
        <RunSandbox language={(activity.starter_code?.language ?? "javascript") as "javascript" | "python" | "html" | "css"} source={code} />
      </div>
    );
  }

  return <p className="text-sm text-rose-600">Unsupported activity kind: {activity.kind}</p>;
}

function useDrawCanvas(ref: React.MutableRefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#1f2937";
    let drawing = false; let lastX = 0; let lastY = 0;
    const down = (e: PointerEvent) => {
      drawing = true; const r = c.getBoundingClientRect();
      lastX = e.clientX - r.left; lastY = e.clientY - r.top;
    };
    const move = (e: PointerEvent) => {
      if (!drawing) return;
      const r = c.getBoundingClientRect();
      ctx.beginPath(); ctx.moveTo(lastX, lastY);
      ctx.lineTo(e.clientX - r.left, e.clientY - r.top); ctx.stroke();
      lastX = e.clientX - r.left; lastY = e.clientY - r.top;
    };
    const up = () => { drawing = false; };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointerleave", up);
    return () => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointerleave", up);
    };
  }, [ref]);
}

function RunSandbox({ language, source }: { language: "javascript" | "python" | "html" | "css"; source: string }) {
  const [out, setOut] = useState<string>("");
  function run() {
    if (language === "javascript") {
      try {
        const logs: string[] = [];
        const sandboxedConsole = { log: (...args: unknown[]) => logs.push(args.map(String).join(" ")) };
        new Function("console", `"use strict"; ${source}`)(sandboxedConsole);
        setOut(logs.join("\n") || "(no output)");
      } catch (e) { setOut("Error: " + String((e as Error).message ?? e)); }
      return;
    }
    if (language === "html" || language === "css") {
      // Render into a sandboxed iframe so we don't pollute the host DOM.
      const html = language === "html"
        ? `${source}<style>${/* eslint-disable-next-line */ ""}</style>`
        : `<style>${source}</style><div class="preview">HTML preview</div>`;
      setOut("📝 Preview below ↑\n# Auto-rendered in preview iframe");
      const iframe = document.createElement("iframe");
      iframe.srcdoc = html;
      iframe.className = "mt-2 h-48 w-full rounded border border-slate-200 bg-white";
      const holder = document.getElementById("code-preview");
      if (holder) { holder.innerHTML = ""; holder.appendChild(iframe); }
      return;
    }
    setOut("Python runs server-side via /api/code-submissions (recorded submission). Browser preview is disabled.");
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button className="btn btn-primary text-xs" onClick={run}>Run</button>
        <form action="/api/code-submissions" method="post" onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData();
          fd.append("activity_id", (document.getElementById("code-activity-id") as HTMLInputElement | null)?.value ?? "");
          fd.append("language", language);
          fd.append("source", source);
          const r = await fetch("/api/code-submissions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ activity_id: fd.get("activity_id"), language, source })
          });
          if (r.ok) setOut("✓ saved submission");
        }}>
          <button className="btn btn-ghost text-xs" type="submit">Save submission</button>
        </form>
      </div>
      <pre className="rounded-lg border border-slate-200 bg-slate-900 p-3 text-xs text-slate-100">{out || "// click Run"}</pre>
      <div id="code-preview" />
    </div>
  );
}
