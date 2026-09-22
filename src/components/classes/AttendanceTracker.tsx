"use client";
import { useEffect, useMemo, useState } from "react";

type Student = { id: string; full_name: string; email: string };
type AttendanceRecord = { id: string; student_id: string; date: string; status: AttendanceStatus };
type AttendanceStatus = "present" | "absent" | "tardy" | "excused";

const STATUS_OPTIONS: AttendanceStatus[] = ["present", "tardy", "excused", "absent"];
const STATUS_STYLES: Record<AttendanceStatus, string> = {
  present: "bg-emerald-100 text-emerald-700 border-emerald-200",
  tardy: "bg-amber-100 text-amber-700 border-amber-200",
  excused: "bg-sky-100 text-sky-700 border-sky-200",
  absent: "bg-rose-100 text-rose-700 border-rose-200"
};

export default function AttendanceTracker({ classId }: { classId: string }) {
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [draft, setDraft] = useState<Record<string, AttendanceStatus>>({});
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/classes/${classId}/attendance?days=14&date=${selectedDate}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "attendance load failed");
      const nextStudents = Array.isArray(j.students) ? j.students as Student[] : [];
      const nextRecords = Array.isArray(j.records) ? j.records as AttendanceRecord[] : [];
      setStudents(nextStudents);
      setRecords(nextRecords);
      const nextDraft: Record<string, AttendanceStatus> = {};
      for (const rec of nextRecords.filter((x) => x.date === selectedDate)) nextDraft[rec.student_id] = rec.status;
      setDraft(nextDraft);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classId, selectedDate]);

  const stats = useMemo(() => {
    const counter: Record<AttendanceStatus, number> = { present: 0, absent: 0, tardy: 0, excused: 0 };
    for (const status of Object.values(draft)) counter[status] += 1;
    return counter;
  }, [draft]);

  const recentByStudent = useMemo(() => {
    const map: Record<string, AttendanceRecord[]> = {};
    for (const rec of records) {
      (map[rec.student_id] ||= []).push(rec);
    }
    for (const key of Object.keys(map)) map[key] = map[key].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
    return map;
  }, [records]);

  function setStatus(studentId: string, status: AttendanceStatus) {
    setDraft((prev) => ({ ...prev, [studentId]: status }));
    setMessage(null);
  }

  async function save() {
    const payload = students
      .map((student) => ({ student_id: student.id, status: draft[student.id] }))
      .filter((row): row is { student_id: string; status: AttendanceStatus } => Boolean(row.status));
    if (payload.length === 0) {
      setErr("Select at least one attendance status before saving.");
      return;
    }
    setSaving(true);
    setErr(null);
    setMessage(null);
    try {
      const r = await fetch(`/api/classes/${classId}/attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: selectedDate, records: payload })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "save failed");
      setMessage(`Saved ${j.saved ?? payload.length} attendance records for ${selectedDate}.`);
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Attendance tracker</h3>
          <p className="mt-1 text-sm text-slate-600">Record the daily roll call, then review each learner&apos;s recent attendance trail in the same panel.</p>
        </div>
        <div className="flex items-end gap-2">
          <div>
            <label className="label">Date</label>
            <input className="input" type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
          </div>
          <button className="btn btn-primary text-xs" disabled={saving || busy || students.length === 0} onClick={save}>
            {saving ? "Saving…" : "Save attendance"}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        {STATUS_OPTIONS.map((status) => (
          <span key={status} className={`rounded-full border px-3 py-1 font-medium ${STATUS_STYLES[status]}`}>
            {status} · {stats[status]}
          </span>
        ))}
      </div>

      {busy && <p className="mt-4 text-sm text-slate-500">Loading attendance…</p>}
      {err && <p className="mt-4 text-sm text-rose-600">{err}</p>}
      {message && <p className="mt-4 text-sm text-emerald-700">{message}</p>}

      {!busy && students.length === 0 && <p className="mt-4 text-sm text-slate-400">Add students to the roster before taking attendance.</p>}

      {students.length > 0 && (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="pb-3">Student</th>
                <th className="pb-3">Email</th>
                <th className="pb-3">Today</th>
                <th className="pb-3">Recent history</th>
              </tr>
            </thead>
            <tbody>
              {students.map((student) => (
                <tr key={student.id} className="border-b border-slate-100 align-top last:border-b-0">
                  <td className="py-3 font-medium text-slate-900">{student.full_name}</td>
                  <td className="py-3 text-slate-500">{student.email}</td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-2">
                      {STATUS_OPTIONS.map((status) => {
                        const active = draft[student.id] === status;
                        return (
                          <button
                            key={status}
                            type="button"
                            onClick={() => setStatus(student.id, status)}
                            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${active ? STATUS_STYLES[status] : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"}`}
                          >
                            {status}
                          </button>
                        );
                      })}
                    </div>
                  </td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-2">
                      {(recentByStudent[student.id] ?? []).length === 0 && <span className="text-xs text-slate-400">No records yet.</span>}
                      {(recentByStudent[student.id] ?? []).map((rec) => (
                        <span key={rec.id} className={`rounded-full border px-3 py-1 text-xs font-medium ${STATUS_STYLES[rec.status]}`}>
                          {rec.date} · {rec.status}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
