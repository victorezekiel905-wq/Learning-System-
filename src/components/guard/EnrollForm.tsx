"use client";
import { useState } from "react";

export default function EnrollForm() {
  const [deviceUid, setDeviceUid] = useState("");
  const [kind, setKind] = useState<"browser"|"agent">("browser");
  const [resp, setResp] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null); setResp(null);
    const r = await fetch("/api/devices/enroll", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_uid: deviceUid, kind })
    });
    setBusy(false);
    if (!r.ok) { setErr("Enrollment failed (status " + r.status + ")"); return; }
    const j = await r.json();
    setResp("Enrolled. id=" + j.id);
    setDeviceUid("");
  }

  async function heartbeat() {
    if (!deviceUid) return;
    setBusy(true);
    await fetch("/api/devices/heartbeat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_uid: deviceUid })
    });
    setBusy(false);
    setResp("Heartbeat sent.");
  }

  async function report() {
    setBusy(true);
    await fetch("/api/devices/events", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_uid: deviceUid, kind: "tab_changed", url: location.href, title: document.title })
    });
    setBusy(false);
    setResp("Event reported.");
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="label">Device UID</label>
        <input className="input" required value={deviceUid} onChange={(e)=>setDeviceUid(e.target.value)} placeholder="ext-abc123" />
      </div>
      <div>
        <label className="label">Kind</label>
        <select className="input" value={kind} onChange={(e)=>setKind(e.target.value as "browser"|"agent")}>
          <option value="browser">Browser extension</option>
          <option value="agent">Device agent</option>
        </select>
      </div>
      <button className="btn btn-primary w-full" disabled={busy || !deviceUid}>{busy ? "…" : "Enroll"}</button>
      <div className="flex gap-2">
        <button type="button" className="btn btn-ghost flex-1 text-xs" disabled={busy || !deviceUid} onClick={heartbeat}>Heartbeat</button>
        <button type="button" className="btn btn-ghost flex-1 text-xs" disabled={busy || !deviceUid} onClick={report}>Report event</button>
      </div>
      {resp && <p className="text-sm text-emerald-700">{resp}</p>}
      {err && <p className="text-sm text-rose-600">{err}</p>}
    </form>
  );
}
