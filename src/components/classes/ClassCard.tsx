"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Member = { id: string; role: string; users: { id: string; full_name: string; email: string } | null };

export default function ClassCard({ classId, name, joinCode }: { classId: string; name: string; joinCode: string }) {
  const router = useRouter();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/classes/${classId}/roster`).then(r => r.json())
      .then((j) => setMembers(j as Member[])).catch(() => setMembers([]));
  }, [classId]);

  async function addStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    const r = await fetch(`/api/classes/${classId}/roster`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() })
    });
    setBusy(false);
    if (!r.ok) { alert((await r.json()).error ?? "failed"); return; }
    setEmail("");
    const j = await fetch(`/api/classes/${classId}/roster`).then(r => r.json());
    setMembers(j as Member[]);
    router.refresh();
  }

  async function remove(userId: string) {
    await fetch(`/api/classes/${classId}/roster`, {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId })
    });
    const j = await fetch(`/api/classes/${classId}/roster`).then(r => r.json());
    setMembers(j as Member[]);
  }

  const students = (members ?? []).filter(m => m.role === "student");

  return (
    <section className="card flex flex-col p-5">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-semibold">{name}</h3>
          <p className="mt-0.5 text-xs text-slate-500">Join code <span className="font-mono font-semibold text-brand-600">{joinCode}</span></p>
        </div>
        <button onClick={() => navigator.clipboard?.writeText(joinCode)}
          className="btn btn-ghost text-xs">Copy code</button>
      </div>

      <div className="mt-4 flex-1">
        <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Roster · {students.length}</p>
        <ul className="max-h-40 divide-y divide-slate-100 overflow-auto">
          {members === null && <li className="py-1 text-xs text-slate-400">Loading…</li>}
          {(students ?? []).length === 0 && <li className="py-1 text-xs text-slate-400">No students yet.</li>}
          {students.map(s => (
            <li key={s.id} className="flex items-center justify-between py-1.5 text-sm">
              <span className="truncate">{s.users?.full_name ?? "?"}</span>
              <div className="flex items-center gap-2">
                <span className="hidden text-xs text-slate-400 sm:block">{s.users?.email}</span>
                <button onClick={() => remove(s.users?.id ?? "")} className="text-xs text-rose-500 hover:underline">remove</button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <form onSubmit={addStudent} className="mt-3 flex gap-2">
        <input className="input text-xs" placeholder="student email to add" type="email"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn btn-primary text-xs" disabled={busy || !email.trim()}>Add</button>
      </form>
    </section>
  );
}
