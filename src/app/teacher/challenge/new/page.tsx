import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChallengeForm } from "@/components/challenge/ChallengeForm";

export default async function NewChallenge() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: classes }, { data: activities }] = await Promise.all([
    sb.from("classes").select("id,name,join_code").order("created_at", { ascending: false }).limit(20),
    sb.from("activities").select("id,title,kind").order("created_at", { ascending: false }).limit(20)
  ]);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-sm font-medium text-brand-600">Fusion Challenge</p>
      <h1 className="text-2xl font-semibold">Start a game-based quiz</h1>
      <p className="mt-1 text-slate-600">Pick a class and pick an activity as the source. Students join with the lobby code.</p>
      <ChallengeForm
        classes={(classes ?? []).map((c: { id: string; name: string; join_code: string }) => ({ id: c.id, name: c.name, join_code: c.join_code }))}
        activities={(activities ?? []).map((a: { id: string; title: string; kind: string }) => ({ id: a.id, title: a.title, kind: a.kind }))}
      />
    </main>
  );
}
