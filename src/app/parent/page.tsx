"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type ParentLink = {
  id: string;
  parent_user_id?: string;
  student_user_id?: string;
  relation?: string;
  scopes?: string[];
  consent_at?: string;
  users?: { full_name?: string; email?: string } | null;
  attendance_summary?: Record<string, number>;
  recent_attendance?: Array<{ id: string; date: string; status: string; classes?: { name?: string } | null }>;
};

// §12 — Parent portal: shows linked students + their attendance + summaries.
// Strictly read-only scope enforced server-side via parent_links RLS policies.
export default function ParentPage() {
  const [links, setLinks] = useState<ParentLink[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/parent-link");
      const j = await r.json();
      setLinks(Array.isArray(j) ? j : []);
      setLoading(false);
    })();
  }, []);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <header className="mb-8">
        <p className="text-sm font-medium text-brand-600">Parent Portal</p>
        <h1 className="text-2xl font-semibold">Your linked students</h1>
        <p className="mt-1 text-sm text-slate-600">This portal only shows students a school administrator has linked to your account. Scope is dictated by the school&apos;s enabled features such as attendance, summaries, and screen-time signals.</p>
      </header>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {!loading && links.length === 0 && (
        <div className="card p-6 text-center">
          <p className="text-sm text-slate-500">No students linked yet. Ask your school administrator to invite you.</p>
          <Link href="/login" className="btn btn-ghost mt-3 text-xs">Back to sign in</Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {links.map((link) => {
          const student = link.users ?? null;
          const scopes = link.scopes ?? [];
          const summary = link.attendance_summary ?? {};
          const recent = link.recent_attendance ?? [];
          return (
            <div key={link.id} className="card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-semibold">{student?.full_name ?? "Student"}</p>
                  <p className="text-xs text-slate-500">{student?.email}</p>
                  <p className="mt-1 text-xs text-slate-400">Relation: {link.relation ?? "guardian"}</p>
                </div>
                <button
                  className="btn btn-ghost text-xs"
                  onClick={async () => {
                    if (!confirm("Revoke this link? The school can re-invite you later.")) return;
                    await fetch("/api/parent-link", {
                      method: "DELETE",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        parent_user_id: link.parent_user_id,
                        student_user_id: link.student_user_id
                      })
                    });
                    setLinks((prev) => prev.filter((x) => x.id !== link.id));
                  }}
                >
                  Revoke link
                </button>
              </div>

              <div className="mt-3 flex flex-wrap gap-1">
                {scopes.map((scope) => (
                  <span key={scope} className="rounded bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-wide">{scope}</span>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                {(["present", "tardy", "excused", "absent"] as const).map((key) => (
                  <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="uppercase tracking-wide text-slate-400">{key}</p>
                    <p className="mt-1 text-base font-semibold text-slate-900">{summary[key] ?? 0}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4">
                <h2 className="text-sm font-semibold text-slate-900">Recent attendance</h2>
                {recent.length === 0 && <p className="mt-2 text-xs text-slate-400">No attendance records shared yet.</p>}
                <ul className="mt-2 space-y-2 text-sm">
                  {recent.map((entry) => (
                    <li key={entry.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                      <div>
                        <p className="font-medium text-slate-900">{entry.classes?.name ?? "Class"}</p>
                        <p className="text-xs text-slate-500">{entry.date}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${entry.status === "present" ? "bg-emerald-100 text-emerald-700" : entry.status === "tardy" ? "bg-amber-100 text-amber-700" : entry.status === "excused" ? "bg-sky-100 text-sky-700" : "bg-rose-100 text-rose-700"}`}>
                        {entry.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <p className="mt-4 text-xs text-slate-400">Consent recorded: {String(link.consent_at ?? "").slice(0, 10)}</p>
            </div>
          );
        })}
      </div>
    </main>
  );
}
