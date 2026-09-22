import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PolicyForm from "@/components/admin/PolicyForm";

export default async function AdminPage() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: policies }, { data: logs }] = await Promise.all([
    sb.from("environment_policies").select("*").order("created_at", { ascending: false }).limit(20),
    sb.from("audit_logs").select("*").order("ts", { ascending: false }).limit(20)
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <p className="text-sm font-medium text-brand-600">Fusion Admin</p>
      <h1 className="text-2xl font-semibold">Policies & audit</h1>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 mt-6">
        <section className="card lg:col-span-2 p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase text-slate-600">Environment policies</h2>
          <ul className="divide-y divide-slate-100">
            {(policies ?? []).length === 0 && <li className="py-3 text-slate-400">No policies yet.</li>}
            {(policies ?? []).map((p: { id: string; name: string; mode: string; allowlist: string[]; blocklist: string[]; required_urls: string[] }) => (
              <li key={p.id} className="py-3">
                <p className="font-medium">{p.name} <span className="rounded bg-slate-100 px-2 py-0.5 text-xs">{p.mode}</span></p>
                <p className="text-xs text-slate-500">Allow {p.allowlist.length} · Block {p.blocklist.length} · Required {p.required_urls.length}</p>
              </li>
            ))}
          </ul>
        </section>
        <aside className="card p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase text-slate-600">Create policy</h2>
          <PolicyForm />
        </aside>
      </div>

      <section className="card mt-6 p-4">
        <h2 className="mb-3 text-sm font-semibold uppercase text-slate-600">Audit log</h2>
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-slate-500"><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th></tr></thead>
          <tbody>
            {(logs ?? []).length === 0 && <tr><td colSpan={4} className="py-6 text-slate-400 text-center">No audits.</td></tr>}
            {(logs ?? []).map((l: { id: string; ts: string; actor_id: string | null; action: string; target: string | null }) => (
              <tr key={l.id} className="border-t border-slate-100">
                <td className="py-2">{new Date(l.ts).toLocaleString()}</td>
                <td className="font-mono text-xs">{l.actor_id?.slice(0,8) ?? "—"}</td>
                <td>{l.action}</td>
                <td className="font-mono text-xs">{l.target?.slice(0,16) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
