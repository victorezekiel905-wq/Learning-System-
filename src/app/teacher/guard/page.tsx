import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EnrollForm from "@/components/guard/EnrollForm";

export default async function GuardPage() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: devices }, { data: events }] = await Promise.all([
    sb.from("devices").select("*").order("last_seen_at", { ascending: false }).limit(50),
    sb.from("browser_events").select("*").order("ts", { ascending: false }).limit(50)
  ]);
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <p className="text-sm font-medium text-brand-600">Fusion Guard</p>
      <h1 className="text-2xl font-semibold">Devices & telemetry</h1>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 mt-6">
        <section className="card lg:col-span-2 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase text-slate-600">Enrolled devices</h2>
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase text-slate-500"><tr><th>UID</th><th>Kind</th><th>Status</th><th>Last seen</th></tr></thead>
            <tbody>
              {(devices ?? []).length === 0 && <tr><td colSpan={4} className="py-6 text-slate-400 text-center">No devices. Install the browser extension and call /api/devices/enroll.</td></tr>}
              {(devices ?? []).map((d: { id: string; device_uid: string; kind: string; status: string; last_seen_at: string | null }) => (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className="py-2 font-mono text-xs">{d.device_uid.slice(0, 12)}</td>
                  <td>{d.kind}</td>
                  <td>{d.status}</td>
                  <td>{d.last_seen_at ? new Date(d.last_seen_at).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <aside className="card p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase text-slate-600">Enroll new device</h2>
          <EnrollForm />
        </aside>
      </div>

      <section className="card mt-6 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase text-slate-600">Recent browser events</h2>
        <ul className="divide-y divide-slate-100">
          {(events ?? []).length === 0 && <li className="py-3 text-slate-400">No events yet.</li>}
          {(events ?? []).map((e: { id: string; kind: string; url: string | null; ts: string }) => (
            <li key={e.id} className="py-2 text-sm">
              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{e.kind}</span>
              {e.url && <span className="ml-2 text-slate-600">{e.url}</span>}
              <span className="ml-2 text-xs text-slate-400">{new Date(e.ts).toLocaleTimeString()}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
