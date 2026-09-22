import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import NewSessionForm from "@/components/live/NewSessionForm";

export default async function NewLiveSession() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: classes }, { data: lessons }, { data: policies }] = await Promise.all([
    sb.from("classes").select("id,name").order("created_at", { ascending: false }).limit(20),
    sb.from("lessons").select("id,title").eq("status", "published").limit(20),
    sb.from("environment_policies").select("id,name,mode").limit(20)
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-sm font-medium text-brand-600">Fusion Live · Setup</p>
      <h1 className="text-2xl font-semibold">Start a new live session</h1>
      <NewSessionForm
        classes={(classes ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))}
        lessons={(lessons ?? []).map((l: { id: string; title: string }) => ({ id: l.id, title: l.title }))}
        policies={(policies ?? []).map((p: { id: string; name: string; mode: string }) => ({ id: p.id, name: p.name, mode: p.mode }))}
      />
    </main>
  );
}
