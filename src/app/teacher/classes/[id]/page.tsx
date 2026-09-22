"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import RosterImporter from "@/components/classes/RosterImporter";
import AttendanceTracker from "@/components/classes/AttendanceTracker";

// §11 + §19 — Roster page with bulk import and live attendance capture.
export default function ClassRosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [cls, setCls] = useState<{ id: string; name: string; join_code: string } | null>(null);

  useEffect(() => {
    (async () => {
      const c = await fetch("/api/classes");
      const arr = await c.json();
      const me = Array.isArray(arr) ? arr.find((x: { id: string }) => x.id === id) : null;
      setCls(me ?? null);
      const r = await fetch(`/api/classes/${id}/roster`);
      if (r.ok) setRows(await r.json());
    })();
  }, [id]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <p className="text-sm font-medium text-brand-600">Class operations</p>
          <h1 className="text-2xl font-semibold">{cls?.name ?? "Class"}</h1>
          <p className="text-xs text-slate-500">Join code: <span className="font-mono">{cls?.join_code}</span></p>
        </div>
        <Link href="/teacher/classes" className="btn btn-ghost text-xs">← All classes</Link>
      </header>

      <section className="card p-0">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-semibold">Roster</h2>
          <p className="mt-1 text-sm text-slate-600">See every enrolled learner, then import or update the roster in bulk.</p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="p-3">Name</th>
              <th className="p-3">Email</th>
              <th className="p-3">Role</th>
              <th className="p-3">Joined</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-xs text-slate-400">No members yet.</td></tr>}
            {(rows as Array<{ id: string; users: { full_name: string; email: string } | null; role: string; joined_at: string }>).map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="p-3">{r.users?.full_name ?? "—"}</td>
                <td className="p-3 text-slate-500">{r.users?.email ?? "—"}</td>
                <td className="p-3"><span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{r.role}</span></td>
                <td className="p-3 text-xs text-slate-500">{(r.joined_at ?? "").slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-8 grid grid-cols-1 gap-6 xl:grid-cols-[1.1fr,0.9fr]">
        <AttendanceTracker classId={id} />
        <RosterImporter classId={id} />
      </section>
    </main>
  );
}
