import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import CreateClassForm from "@/components/classes/CreateClassForm";
import ClassCard from "@/components/classes/ClassCard";

export default async function ClassesPage() {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await sb.from("users").select("id,tenant_id,role").eq("id", user.id).maybeSingle();

  const { data: classes } = await sb.from("classes")
    .select("id,name,join_code,created_at")
    .order("created_at", { ascending: false }).limit(50);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <p className="text-sm font-medium text-brand-600">Classes & rosters</p>
          <h1 className="text-2xl font-semibold">Your classes</h1>
        </div>
        {me && <CreateClassForm />}
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {(classes ?? []).length === 0 && (
          <div className="card col-span-full p-10 text-center text-slate-500">No classes yet — create one to get a join code.</div>
        )}
        {(classes ?? []).map((c: { id: string; name: string; join_code: string }) => (
          <ClassCard key={c.id} classId={c.id} name={c.name} joinCode={c.join_code} />
        ))}
      </div>
    </main>
  );
}
