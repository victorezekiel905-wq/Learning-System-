import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ActivityForm from "@/components/studio/ActivityForm";

export default async function AssessPage() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { data: lessons } = await sb.from("lessons").select("id,title").order("created_at", { ascending: false }).limit(50);
  const { data: activities } = await sb.from("activities").select("*").order("created_at", { ascending: false }).limit(50);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-8">
        <p className="text-sm font-medium text-brand-600">Fusion Assess</p>
        <h1 className="text-2xl font-semibold">Activity & question bank</h1>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="card p-6 lg:col-span-2">
          <h2 className="mb-3 text-lg font-semibold">Existing activities</h2>
          <ul className="divide-y divide-slate-100">
            {(activities ?? []).length === 0 && <li className="py-3 text-sm text-slate-500">No activities yet.</li>}
            {(activities ?? []).map((a: { id: string; title: string; kind: string; created_at: string }) => (
              <li key={a.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium">{a.title}</p>
                  <p className="text-xs text-slate-500">{a.kind}</p>
                </div>
                <span className="text-xs text-slate-400">{new Date(a.created_at).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </section>

        <aside className="card p-6">
          <h2 className="mb-3 text-lg font-semibold">Create activity</h2>
          <ActivityForm lessons={(lessons ?? []).map((l: { id: string; title: string }) => ({ id: l.id, title: l.title }))} />
        </aside>
      </div>
    </main>
  );
}
