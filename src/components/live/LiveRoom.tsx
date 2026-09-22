"use client";
import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Participant = { id: string; user_id: string; status: string; joined_at: string };
type Announcement = { id: string; body: string; user_id: string; created_at: string };
type Command = { id: string; kind: string; target_student_id: string; state: string; created_at: string };
type EnvEvent = { id: string; kind: string; url: string | null; severity: string; acknowledged: boolean; ts: string; student_id: string; users: { full_name: string } | null };
type Hand = { id: string; message: string; created_at: string; users: { full_name: string } | null };
type Snap = { id: string; device_id: string; data_url: string | null; url: string | null; captured_at: string };

export default function LiveRoom(props: {
  session: { id: string; state: string; mode: string; join_code: string; class_id: string };
  participants: Participant[];
  announcements: Announcement[];
  commands: Command[];
}) {
  const [parts, setParts] = useState(props.participants);
  const [names, setNames] = useState<Record<string, string>>({});
  const [anns, setAnns] = useState(props.announcements);
  const [cmds, setCmds] = useState(props.commands);
  const [events, setEvents] = useState<EnvEvent[]>([]);
  const [hands, setHands] = useState<Hand[]>([]);
  const [snaps, setSnaps] = useState<Record<string, Snap>>({});
  const [spot, setSpot] = useState<Snap | null>(null);
  const [annBody, setAnnBody] = useState("");
  const [policies, setPolicies] = useState<{ id: string; name: string; mode: string }[]>([]);
  const [policyId, setPolicyId] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // participant names via same-tenant users RLS
  useEffect(() => {
    if (parts.length === 0) return;
    const sb = createClient();
    const ids = parts.map((p) => p.user_id);
    sb.from("users").select("id,full_name").in("id", ids).then(({ data }: { data: any[] | null }) => {
      const m: Record<string, string> = {};
      (data ?? []).forEach((u: any) => { m[(u as { id: string }).id] = (u as { full_name: string }).full_name; });
      setNames(m);
    });
  }, [parts]);

  useEffect(() => {
    const sb = createClient();
    const ch = sb.channel(`live-${props.session.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "session_participants", filter: `session_id=eq.${props.session.id}` },
        (p: any) => {
          if (p.eventType === "DELETE") setParts((arr) => arr.filter((x) => x.id !== (p.old as Participant).id));
          else setParts((arr) => upsert(arr, p.new as Participant, (x) => x.id));
        })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "announcements", filter: `session_id=eq.${props.session.id}` },
        (p: any) => setAnns((arr) => [p.new as Announcement, ...arr].slice(0, 50)))
      .on("postgres_changes", { event: "*", schema: "public", table: "teacher_commands", filter: `session_id=eq.${props.session.id}` },
        (p: any) => setCmds((arr) => upsert(arr, p.new as Command, (x) => x.id)))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "environment_events", filter: `session_id=eq.${props.session.id}` },
        (p: any) => setEvents((arr) => [p.new as EnvEvent, ...arr].slice(0, 50)))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "raise_hands", filter: `session_id=eq.${props.session.id}` },
        (p: any) => setHands((arr) => [p.new as Hand, ...arr].slice(0, 50)))
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "screen_snapshots", filter: `session_id=eq.${props.session.id}` },
        (p: any) => {
          const s = p.new as Snap;
          setSnaps((m) => ({ ...m, [s.device_id]: s }));
        })
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, [props.session.id]);

  useEffect(() => {
    Promise.all([
      fetch(`/api/class-sessions/${props.session.id}/environment-events`).then((r) => r.json()),
      fetch(`/api/class-sessions/${props.session.id}/hands`).then((r) => r.json()),
      fetch("/api/environments").then((r) => r.json()).catch(() => [])
    ]).then(([ev, h, p]) => {
      setEvents(ev ?? []);
      setHands(h ?? []);
      setPolicies(Array.isArray(p) ? p : []);
      if (Array.isArray(p) && p.length) setPolicyId((cur) => cur || "");
    }).catch(() => {});
  }, [props.session.id]);

  async function endSession() {
    if (!confirm("End this session for everyone?")) return;
    await fetch(`/api/class-sessions/${props.session.id}/end`, { method: "POST" });
    location.reload();
  }
  async function start() {
    await fetch(`/api/class-sessions/${props.session.id}/start`, { method: "POST" });
    location.reload();
  }
  async function announce() {
    if (!annBody.trim()) return;
    setBusy(true);
    await fetch(`/api/class-sessions/${props.session.id}/announcements`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: annBody })
    });
    setBusy(false); setAnnBody("");
  }
  async function sendCommand(targetId: string, kind: "open_tab" | "close_tab" | "redirect" | "focus" | "lock") {
    await fetch(`/api/class-sessions/${props.session.id}/commands`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_student_id: targetId, kind, payload: {} })
    });
    if (kind === "open_tab" || kind === "redirect") {
      const url = prompt(`${kind === "open_tab" ? "Open URL" : "Redirect to URL"}:`);
      if (!url) return;
      await fetch(`/api/class-sessions/${props.session.id}/commands`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_student_id: targetId, kind, payload: { url } })
      });
    }
  }
  async function ackEvent(id: string) {
    await fetch(`/api/class-sessions/${props.session.id}/environment-events`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: id })
    });
    setEvents((arr) => arr.map((e) => (e.id === id ? { ...e, acknowledged: true } : e)));
  }
  async function resolveHand(id: string) {
    await fetch(`/api/class-sessions/${props.session.id}/hands`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hand_id: id })
    });
    setHands((arr) => arr.filter((h) => h.id !== id));
  }
  async function applyPolicy() {
    if (!policyId) return;
    await fetch(`/api/class-sessions/${props.session.id}/environment/start`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ policy_id: policyId })
    });
  }

  const snapList = Object.values(snaps).sort((a, b) => b.captured_at.localeCompare(a.captured_at)).slice(0, 12);

  return (
    <main className="mx-auto max-w-7xl px-6 py-6">
      <header className="card mb-6 flex items-end justify-between p-4">
        <div>
          <p className="text-xs uppercase text-brand-600">Fusion Live</p>
          <h1 className="text-xl font-semibold">Session · Join code <span className="font-mono text-brand-600">{props.session.join_code}</span></h1>
        </div>
        <div className="flex items-center gap-2">
          {props.session.state === "scheduled" && <button className="btn btn-primary" onClick={start}>Start session</button>}
          {props.session.state === "live" && <a className="btn btn-ghost text-xs" href={`/teacher/live/${props.session.id}/webrtc`}>Open A/V room</a>}
          {props.session.state === "live" && <button className="btn btn-danger" onClick={endSession}>End session</button>}
          <span className={"rounded-full px-3 py-1 text-xs " + ({
            live: "bg-emerald-100 text-emerald-700",
            scheduled: "bg-slate-100 text-slate-700",
            ended: "bg-slate-200 text-slate-500"
          } as Record<string, string>)[props.session.state]}>{props.session.state}</span>
        </div>
      </header>

      <div className="grid grid-cols-12 gap-4">
        <section className="card col-span-7 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase text-slate-600">Student Screen Wall</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {parts.length === 0 && <p className="col-span-full py-8 text-center text-slate-400">No students connected yet.</p>}
            {parts.map((p) => (
              <div key={p.id} className="rounded-md border border-slate-200 p-3">
                <div className="mb-2 flex h-20 items-center justify-center rounded bg-slate-100 text-xl">{names[p.user_id] ? "🎓" : "…"}</div>
                <p className="truncate text-xs font-medium">{names[p.user_id] ?? p.user_id.slice(0, 8)}</p>
                <p className="text-xs">Status: {p.status}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  <button onClick={() => sendCommand(p.user_id, "open_tab")} className="btn btn-ghost text-xs">Open</button>
                  <button onClick={() => sendCommand(p.user_id, "close_tab")} className="btn btn-ghost text-xs">Close</button>
                  <button onClick={() => sendCommand(p.user_id, "redirect")} className="btn btn-ghost text-xs">Redirect</button>
                  <button onClick={() => sendCommand(p.user_id, "focus")} className="btn btn-ghost text-xs">Focus</button>
                  <button onClick={() => sendCommand(p.user_id, "lock")} className="btn btn-ghost text-xs">Lock</button>
                </div>
              </div>
            ))}
          </div>

          <h2 className="mb-2 mt-5 text-sm font-semibold uppercase text-slate-600">
            Screen thumbnails <span className="normal-case text-slate-400">(agent snapshots — click to spotlight)</span>
          </h2>
          <div className="grid grid-cols-3 gap-2 md:grid-cols-4">
            {snapList.length === 0 && <p className="col-span-full py-4 text-center text-xs text-slate-400">No thumbnails yet — pair the browser agent to this session.</p>}
            {snapList.map((s) => (
              <button key={s.id} onClick={() => setSpot(s)} className="group relative overflow-hidden rounded-md border border-slate-200">
                {s.data_url ? <img src={s.data_url} alt="screen" className="h-20 w-full object-cover" /> : <div className="h-20 bg-slate-100" />}
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1 text-[9px] text-white">{s.url ?? s.device_id.slice(0, 8)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="col-span-5 space-y-4">
          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase text-slate-600">Environment alerts</h2>
            {events.length === 0 && <p className="py-2 text-xs text-slate-400">No alerts — all students inside the environment.</p>}
            <ul className="max-h-44 divide-y divide-slate-100 overflow-auto">
              {events.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-2 py-2 text-sm">
                  <div>
                    <span className={"rounded px-1.5 py-0.5 text-[10px] font-semibold " + (e.severity === "critical" ? "bg-rose-100 text-rose-700" : e.severity === "warn" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500")}>{e.severity}</span>
                    <span className="ml-1 font-medium">{e.users?.full_name ?? "Student"}</span> — {e.kind}
                    {e.url && <span className="block truncate text-xs text-slate-400">{e.url}</span>}
                  </div>
                  {!e.acknowledged && <button onClick={() => ackEvent(e.id)} className="btn btn-ghost text-xs">Ack</button>}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
              <select className="input text-xs" value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
                <option value="">— apply policy —</option>
                {policies.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.mode})</option>)}
              </select>
              <button className="btn btn-ghost text-xs" onClick={applyPolicy} disabled={!policyId}>Apply</button>
            </div>
          </div>

          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase text-slate-600">Raise hands</h2>
            {hands.length === 0 && <p className="py-2 text-xs text-slate-400">No raised hands.</p>}
            <ul className="max-h-40 divide-y divide-slate-100 overflow-auto">
              {hands.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span><span className="font-medium">{h.users?.full_name ?? "Student"}</span>{h.message ? ` — ${h.message}` : ""}</span>
                  <button onClick={() => resolveHand(h.id)} className="btn btn-ghost text-xs">Resolve</button>
                </li>
              ))}
            </ul>
          </div>

          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase text-slate-600">Announcements</h2>
            <div className="mb-2 flex gap-2">
              <input className="input" placeholder="Type to broadcast…" value={annBody} onChange={(e) => setAnnBody(e.target.value)} />
              <button className="btn btn-primary" disabled={busy} onClick={announce}>Send</button>
            </div>
            <ul className="max-h-32 overflow-auto divide-y divide-slate-100">
              {anns.map((a) => (
                <li key={a.id} className="py-2 text-sm">{a.body}<span className="ml-2 text-xs text-slate-400">{new Date(a.created_at).toLocaleTimeString()}</span></li>
              ))}
            </ul>
          </div>

          <div className="card p-4">
            <h2 className="mb-3 text-sm font-semibold uppercase text-slate-600">Recent teacher commands</h2>
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500"><tr><th className="py-2">When</th><th>Kind</th><th>Target</th><th>State</th></tr></thead>
              <tbody>
                {cmds.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-xs text-slate-400">No commands sent.</td></tr>}
                {cmds.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="py-2">{new Date(c.created_at).toLocaleTimeString()}</td>
                    <td>{c.kind}</td>
                    <td className="text-xs">{names[c.target_student_id] ?? c.target_student_id.slice(0, 8)}</td>
                    <td>{c.state}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {spot && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-8" onClick={() => setSpot(null)}>
          <div className="max-w-4xl">
            {spot.data_url && <img src={spot.data_url} alt="spotlight" className="max-h-[80vh] w-full rounded-md" />}
            <p className="mt-2 text-center text-xs text-white">Spotlight: {spot.url ?? "screen"}{" "}
              <span className="text-slate-400">— click anywhere to close. Student is informed of sharing per blueprint §3.7.</span></p>
          </div>
        </div>
      )}
    </main>
  );
}

function upsert<T>(arr: T[], item: T, key: (x: T) => string): T[] {
  const i = arr.findIndex((x) => key(x) === key(item));
  if (i >= 0) { const n = [...arr]; n[i] = item; return n; }
  return [...arr, item];
}
