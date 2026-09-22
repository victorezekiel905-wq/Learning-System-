import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import LessonImportPanel from "@/components/studio/LessonImportPanel";

export default async function StudioList() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: lessons, error } = await sb
    .from("lessons")
    .select("id,title,status,mode,created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-brand-600">Fusion Studio</p>
          <h1 className="text-2xl font-semibold">Your lessons</h1>
        </div>
        <form action="/api/lessons" method="POST">
          <input type="hidden" name="op" value="create" />
          <input type="hidden" name="title" value="Untitled lesson" />
          <button className="btn btn-primary">+ New lesson</button>
        </form>
      </header>

      <LessonImportPanel />

      {error && (
        <div className="card mb-6 border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Could not load lessons. Run <code>supabase/migrations/20260101000000_init.sql</code> if you see a schema error.
          <div className="mt-1 text-xs text-rose-600">{error.message}</div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {(lessons ?? []).length === 0 && (
          <div className="card col-span-full p-10 text-center text-slate-500">
            No lessons yet — create one from scratch or import an existing deck above.
          </div>
        )}
        {(lessons ?? []).map((l: any) => (
          <Link key={l.id} href={`/teacher/studio/${l.id}`} className="card p-5 hover:border-brand-400">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">{l.title}</h3>
              <span className={"rounded-full px-2 py-0.5 text-xs " + (l.status === "published" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700")}>{l.status}</span>
            </div>
            <p className="mt-1 text-xs text-slate-500">Mode: {l.mode}</p>
            <p className="mt-1 text-xs text-slate-400">{new Date(l.created_at).toLocaleString()}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
