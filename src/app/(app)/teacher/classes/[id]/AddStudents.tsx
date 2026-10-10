"use client";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Download, Printer } from "lucide-react";
import { Alert, Badge, Button, Field, Input, Modal, Tabs } from "@/components/ui";
import { api, errorText } from "@/lib/rpc";
import { readRosterFile, type RosterRow } from "@/lib/roster-file";
import { toCsv } from "@/lib/utils";

export type AddedRow = { name: string; login: string | null; password: string | null; status: string; ok: boolean };

const TEMPLATE = "Name,Admission number,Email\nAda Obi,ADM/2026/001,\nTunde Bello,ADM/2026/002,\n";

/** Add students to a class: one at a time, or from a CSV or Excel file. Shows their logins to print. */
export function AddStudents({ classId, className, onClose }: { classId: string; className: string; onClose: (changed: boolean) => void }) {
  const [tab, setTab] = useState<"one" | "file">("one");
  const [name, setName] = useState("");
  const [admission, setAdmission] = useState("");
  const [email, setEmail] = useState("");
  const [file, setFile] = useState<{ name: string; rows: RosterRow[]; skipped: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<AddedRow[] | null>(null);

  async function send(rows: RosterRow[]) {
    setBusy(true); setErr(null);
    const all: AddedRow[] = [];
    try {
      // In groups of 40, so a long list shows progress and a slow line doesn't time out.
      for (let i = 0; i < rows.length; i += 40) {
        setProgress(rows.length > 40 ? `Adding ${Math.min(i + 40, rows.length)} of ${rows.length}…` : null);
        const r = await api<{ rows: AddedRow[] }>(`/api/classes/${classId}/students`, { method: "POST", json: { students: rows.slice(i, i + 40) } });
        all.push(...r.rows);
      }
      setResult(all);
    } catch (e) { setErr(errorText(e)); if (all.length) setResult(all); }
    setBusy(false); setProgress(null);
  }

  async function choose(f: File | undefined) {
    setErr(null); setFile(null);
    if (!f) return;
    try {
      const parsed = await readRosterFile(f);
      if (parsed.error) { setErr(parsed.error); return; }
      if (!parsed.rows.length) { setErr("No students found in that file."); return; }
      if (parsed.rows.length > 300) { setErr("Add up to 300 students at a time. Split the file and add it in parts."); return; }
      setFile({ name: f.name, rows: parsed.rows, skipped: parsed.skipped });
    } catch { setErr("That file couldn't be read. Save it as .xlsx or .csv and try again."); }
  }

  const added = result?.filter((r) => r.ok) ?? [];
  const failed = result?.filter((r) => !r.ok) ?? [];
  const withPasswords = added.filter((r) => r.password);

  if (result) {
    return (
      <Modal open onClose={() => onClose(true)} wide title={`Added to ${className}`}
        footer={<Button onClick={() => onClose(true)}>Done</Button>}>
        <div className="space-y-4 print:hidden">
          <Alert tone={failed.length ? "warn" : "success"}>
            {added.length} added{failed.length ? `, ${failed.length} not added (see below)` : ""}.
            {withPasswords.length > 0 && " Give each student their username and starting password. They choose their own password the first time they sign in. These passwords are shown only now."}
          </Alert>
          {withPasswords.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={printCards}><Printer className="h-4 w-4" /> Print login cards</Button>
              <Button size="sm" variant="secondary" onClick={() => downloadLogins(className, withPasswords)}><Download className="h-4 w-4" /> Download as a spreadsheet</Button>
            </div>
          )}
          <div className="max-h-[45vh] overflow-y-auto rounded-xl border border-ink-200">
            <table className="table">
              <thead><tr><th>Name</th><th>Username or email</th><th>Starting password</th><th>Result</th></tr></thead>
              <tbody>{result.map((r, i) => (
                <tr key={i}><td className="font-medium">{r.name}</td><td className="font-mono text-[13px]">{r.login ?? ""}</td>
                  <td className="font-mono text-[13px]">{r.password ?? ""}</td>
                  <td>{r.ok ? <Badge tone="green">{r.status}</Badge> : <span className="text-[13px] text-rose-700">{r.status}</span>}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
        <LoginCards className={className} rows={withPasswords} />
      </Modal>
    );
  }

  return (
    <Modal open onClose={() => onClose(false)} wide title={`Add students to ${className}`}
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button>
        {tab === "one"
          ? <Button loading={busy} disabled={!name.trim()} onClick={() => send([{ full_name: name, ...(email.trim() ? { email } : {}), ...(admission.trim() ? { admission_no: admission } : {}) }])}>Add student</Button>
          : <Button loading={busy} disabled={!file} onClick={() => file && send(file.rows)}>{file ? `Add ${file.rows.length} students` : "Add students"}</Button>}</>}>
      <Tabs className="mb-5" value={tab} onChange={(t) => { setTab(t); setErr(null); }} tabs={[{ id: "one", label: "One student" }, { id: "file", label: "From a file (CSV or Excel)" }]} />
      {tab === "one" ? (
        <div className="space-y-4">
          <Field label="Full name" htmlFor="st-name"><Input id="st-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ada Obi" autoFocus /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Admission number" hint="Optional." htmlFor="st-adm"><Input id="st-adm" value={admission} onChange={(e) => setAdmission(e.target.value)} /></Field>
            <Field label="Email" hint="Optional. Without one, the student gets a username." htmlFor="st-email"><Input id="st-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-ink-600">Use a file with a <b>Name</b> column (or <b>First name</b> and <b>Surname</b>). <b>Admission number</b> and <b>Email</b> are optional. The first row must be the column names.</p>
          <div className="flex flex-wrap items-center gap-3">
            <input type="file" aria-label="Choose a class list (Excel or CSV)" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => void choose(e.target.files?.[0])}
              className="block text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-ink-900 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white" />
            <button type="button" className="text-[13px] font-semibold text-brand-700"
              onClick={() => saveFile("class-list-template.csv", TEMPLATE)}>Download a template</button>
          </div>
          {file && (
            <div className="rounded-xl border border-ink-200">
              <p className="border-b border-ink-100 px-4 py-2.5 text-[13px] text-ink-600">
                <b className="text-ink-900">{file.rows.length} students</b> in {file.name}{file.skipped ? ` (${file.skipped} rows without a name skipped)` : ""}
              </p>
              <table className="table">
                <thead><tr><th>Name</th><th>Admission number</th><th>Email</th></tr></thead>
                <tbody>{file.rows.slice(0, 8).map((r, i) => (
                  <tr key={i}><td>{r.full_name}</td><td>{r.admission_no ?? ""}</td><td>{r.email ?? ""}</td></tr>
                ))}</tbody>
              </table>
              {file.rows.length > 8 && <p className="px-4 py-2 text-[13px] text-ink-500">and {file.rows.length - 8} more</p>}
            </div>
          )}
        </div>
      )}
      {progress && <p className="mt-4 text-sm text-ink-600">{progress}</p>}
      {err && <div className="mt-4"><Alert tone="error">{err}</Alert></div>}
    </Modal>
  );
}

/** Prints only the login cards, not the page behind the window. */
export function printCards() {
  document.body.classList.add("print-cards");
  window.print();
  setTimeout(() => document.body.classList.remove("print-cards"), 500);
}

/** Printed only: one card per student with their username and starting password. */
export function LoginCards({ className, rows }: { className: string; rows: AddedRow[] }) {
  const site = typeof window !== "undefined" ? window.location.host : "";
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="login-cards hidden grid-cols-2 gap-4 p-4">
      {rows.map((r, i) => (
        <div key={i} className="break-inside-avoid rounded-xl border border-ink-400 p-4 text-ink-900">
          <p className="text-[12px]">{className}</p>
          <p className="mt-1 text-lg font-bold">{r.name}</p>
          <p className="mt-3 text-[13px]">Sign in at <b>{site}</b>, choose <b>Student</b></p>
          <p className="mt-2 text-[13px]">Username: <span className="font-mono text-base font-bold">{r.login}</span></p>
          <p className="text-[13px]">Starting password: <span className="font-mono text-base font-bold">{r.password}</span></p>
          <p className="mt-2 text-[11px] text-ink-600">You will choose your own password the first time you sign in.</p>
        </div>
      ))}
    </div>, document.body);
}

function saveFile(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadLogins(className: string, rows: AddedRow[]) {
  saveFile(`${className.replace(/[^A-Za-z0-9]+/g, "-")}-logins.csv`, toCsv(rows.map((r) => ({ name: r.name, username: r.login, starting_password: r.password }))));
}
