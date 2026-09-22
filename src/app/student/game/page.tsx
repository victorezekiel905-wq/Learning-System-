"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GameLookup() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await fetch("/api/games/lookup", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ join_code: code.trim().toUpperCase() })
    });
    setBusy(false);
    if (!r.ok) { setErr("No game found for that code."); return; }
    const { id } = await r.json();
    router.push(`/student/game/${id}`);
  }

  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <h1 className="text-2xl font-semibold">Join a game</h1>
      <p className="mt-1 text-sm text-slate-600">Enter the lobby code your teacher showed.</p>
      <form onSubmit={onSubmit} className="card mt-8 space-y-4 p-6">
        <div>
          <label className="label">Game code</label>
          <input className="input uppercase" required maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        {err && <p className="text-sm text-rose-600">{err}</p>}
        <button className="btn btn-primary w-full" disabled={busy || !code.trim()}>{busy ? "Looking…" : "Find game"}</button>
      </form>
    </main>
  );
}
