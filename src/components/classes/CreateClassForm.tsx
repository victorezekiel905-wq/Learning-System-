"use client";
import { useState } from "react";

// §19 — Class CRUD wiring (already partial in v37); here we add a routed
// roster page entry + autocomplete. Kept as a separate component for clarity.
export default function CreateClassForm({ onCreated }: { onCreated?: (id: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await fetch("/api/classes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name })
    });
    setBusy(false);
    if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? "create failed"); return; }
    const j = await r.json();
    onCreated?.((j as { id: string }).id);
    setName("");
  }

  return (
    <form onSubmit={submit} className="card mt-3 flex items-center gap-2 p-3">
      <input className="input flex-1" required placeholder="New class name" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn btn-primary text-xs" disabled={busy}>{busy ? "Creating…" : "+ Create"}</button>
      {err && <span className="text-xs text-rose-600">{err}</span>}
    </form>
  );
}
