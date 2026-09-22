"use client";
import { useState } from "react";

// §19 — CSV roster importer. Parses CSV in-browser (handles quoted commas),
// posts the JSONB rows to /api/roster/import. Reports added/updated/errored.
export default function RosterImporter({ classId }: { classId: string }) {
  const [rows, setRows] = useState<Array<{ email: string; full_name: string; role: string }>>([]);
  const [filename, setFilename] = useState<string | null>(null);
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function parseCsv(text: string): Array<{ email: string; full_name: string; role: string }> {
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const headerCells = splitCsvLine(lines.shift() ?? "").map((s) => s.trim().toLowerCase());
    const out: Array<{ email: string; full_name: string; role: string }> = [];
    const idx = {
      email: headerCells.indexOf("email"),
      full_name: headerCells.indexOf("full_name") >= 0 ? headerCells.indexOf("full_name") : headerCells.indexOf("name"),
      role: headerCells.indexOf("role")
    };
    if (idx.email < 0) return [];

    for (const line of lines) {
      const cells = splitCsvLine(line);
      const email = (cells[idx.email] ?? "").trim().toLowerCase();
      if (!email) continue;
      const fallbackName = email.split("@")[0]?.replace(/[._-]+/g, " ") ?? "";
      out.push({
        email,
        full_name: ((cells[idx.full_name] ?? "").trim() || fallbackName).trim(),
        role: ((cells[idx.role] ?? "student").trim() || "student").toLowerCase()
      });
    }
    return out;
  }

  function splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQuotes = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  async function handleFile(f: File) {
    setFilename(f.name);
    setBusy(true);
    setErr(null);
    setReport(null);
    try {
      const text = await f.text();
      const parsed = parseCsv(text);
      if (parsed.length === 0) setErr("No usable rows found. Include an email column.");
      setRows(parsed);
    } catch (e) {
      setErr("parse: " + (e as Error).message);
      setRows([]);
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/roster/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ class_id: classId, rows })
      });
      const j = await r.json();
      if (!r.ok) setErr(j.error ?? "import failed");
      else setReport(j);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <h3 className="text-lg font-semibold">Bulk roster import</h3>
      <p className="mt-1 text-sm text-slate-600">Upload a CSV with columns <code>email,full_name,role</code>. Roles accepted: <code>student,teacher,school_admin,it_admin</code>. Existing users are updated and new users are added to your tenant roster.</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          id="roster-file"
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        {filename && <span className="text-xs text-slate-500">{filename} · {rows.length} parsed rows</span>}
      </div>
      {rows.length > 0 && (
        <details className="mt-3 text-xs">
          <summary>Preview first 10 rows</summary>
          <pre className="mt-2 max-h-32 overflow-auto rounded bg-slate-50 p-2">{JSON.stringify(rows.slice(0, 10), null, 2)}</pre>
        </details>
      )}
      <button className="btn btn-primary mt-4 text-xs" disabled={busy || rows.length === 0} onClick={commit}>
        {busy ? "Importing…" : "Apply import"}
      </button>
      {err && <p className="mt-2 text-xs text-rose-600">{err}</p>}
      {report && (
        <p className="mt-2 text-xs text-emerald-700">
          ✓ Import summary · added {String(report.added)} · updated {String(report.updated)} · errored {String(report.errored)}
          {Array.isArray(report.errors) && (report.errors as Array<unknown>).length > 0 && <> · first error: {String((report.errors as Array<{ error?: string }>)[0]?.error)}</>}
        </p>
      )}
    </div>
  );
}
