"use client";
import { useEffect, useState } from "react";

// §18/§20 — Reports export runner. Pick a class + report kind, choose
// format (csv / pdf / json), server writes a row to `reports` and returns
// its id. The user clicks download to retrieve the actual file.
export default function ReportsPage() {
  const [classes, setClasses] = useState<Array<{ id: string; name: string; join_code: string }>>([]);
  const [kind, setKind] = useState<"participation" | "env_alerts" | "devices" | "attendance">("participation");
  const [format, setFormat] = useState<"csv" | "pdf" | "json">("csv");
  const [classId, setClassId] = useState<string>("");
  const [reports, setReports] = useState<Array<Record<string, unknown>>>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    const r = await fetch("/api/classes");
    if (r.ok) {
      const j = await r.json();
      setClasses(Array.isArray(j) ? j : []);
      if (!classId && Array.isArray(j) && j.length) setClassId((j[0] as { id: string }).id);
    }
    const rep = await fetch("/api/reports");
    if (rep.ok) setReports(await rep.json());
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

  async function generate() {
    if (!classId) return;
    setBusy(true); setErr(null);
    const r = await fetch("/api/reports", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ class_id: classId, kind, format })
    });
    setBusy(false);
    if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? "generate failed"); return; }
    refresh();
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <p className="text-sm font-medium text-brand-600">Insights & Export</p>
        <h1 className="text-2xl font-semibold">Reports</h1>
        <p className="mt-1 text-sm text-slate-600">Generate a server-side CSV, PDF, or JSON export for participation, attendance, environment alerts, or device health.</p>
      </header>

      <section className="card p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <div>
            <label className="label">Class</label>
            <select className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>
              {classes.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.join_code}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Kind</label>
            <select className="input" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="participation">Participation</option>
              <option value="attendance">Attendance</option>
              <option value="env_alerts">Environment alerts</option>
              <option value="devices">Devices</option>
            </select>
          </div>
          <div>
            <label className="label">Format</label>
            <select className="input" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
              <option value="csv">CSV</option>
              <option value="pdf">PDF</option>
              <option value="json">JSON</option>
            </select>
          </div>
          <div className="flex items-end">
            <button className="btn btn-primary w-full text-xs" disabled={busy || !classId} onClick={generate}>{busy ? "Generating…" : "Generate"}</button>
          </div>
        </div>
        {err && <p className="mt-3 text-xs text-rose-600">{err}</p>}
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Recent reports</h2>
        <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {reports.length === 0 && <li className="p-4 text-sm text-slate-400">No reports yet.</li>}
          {reports.map((r) => (
            <li key={String(r.id)} className="flex items-center gap-3 p-3 text-sm">
              <span className="font-medium">{String(r.name)}</span>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px]">{String(r.kind)}</span>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px]">{String(r.format)}</span>
              <span className="ml-auto text-xs text-slate-500">{String((r.created_at as string) ?? "").slice(0, 16)}</span>
              <a className="btn btn-ghost text-xs" href={`/api/reports/${String(r.id)}/export`} target="_blank" rel="noreferrer">Download</a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
