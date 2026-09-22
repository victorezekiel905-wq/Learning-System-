"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function PolicyForm() {
  const r = useRouter();
  const [name, setName] = useState("Block social during lesson");
  const [mode, setMode] = useState<"monitor"|"focus"|"lock">("focus");
  const [allow, setAllow] = useState("classroom.google.com\nkahoot.it\nwikipedia.org");
  const [block, setBlock] = useState("youtube.com\ntiktok.com\nfacebook.com\ninstagram.com");
  const [req, setReq] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/environments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, mode,
        allowlist: allow.split("\n").map(s=>s.trim()).filter(Boolean),
        blocklist: block.split("\n").map(s=>s.trim()).filter(Boolean),
        required_urls: req.split("\n").map(s=>s.trim()).filter(Boolean)
      })
    });
    setBusy(false);
    if (!res.ok) { alert("Failed"); return; }
    r.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 text-sm">
      <div><label className="label">Name</label><input className="input" value={name} onChange={(e)=>setName(e.target.value)} required /></div>
      <div>
        <label className="label">Mode</label>
        <select className="input" value={mode} onChange={(e)=>setMode(e.target.value as "monitor"|"focus"|"lock")}>
          <option value="monitor">Monitor</option><option value="focus">Focus</option><option value="lock">Lock</option>
        </select>
      </div>
      <div><label className="label">Allowlist (one per line)</label>
        <textarea className="input" rows={4} value={allow} onChange={(e)=>setAllow(e.target.value)} /></div>
      <div><label className="label">Blocklist (one per line)</label>
        <textarea className="input" rows={4} value={block} onChange={(e)=>setBlock(e.target.value)} /></div>
      <div><label className="label">Required URLs (one per line)</label>
        <textarea className="input" rows={2} value={req} onChange={(e)=>setReq(e.target.value)} /></div>
      <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Saving…" : "Save policy"}</button>
    </form>
  );
}
