import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LiveRoom from "@/components/live/LiveRoom";

export default async function LiveRoomPage({ params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { data: session } = await sb.from("class_sessions").select("*").eq("id", params.id).maybeSingle();
  if (!session) return <main className="mx-auto max-w-3xl px-6 py-12">Session not found.</main>;

  const [{ data: parts }, { data: anns }, { data: commands }] = await Promise.all([
    sb.from("session_participants").select("*").eq("session_id", params.id).order("joined_at"),
    sb.from("announcements").select("*").eq("session_id", params.id).order("created_at", { ascending: false }).limit(20),
    sb.from("teacher_commands").select("*").eq("session_id", params.id).order("created_at", { ascending: false }).limit(20)
  ]);

  return (
    <LiveRoom
      session={{
        id: session.id, state: session.state, mode: session.mode,
        join_code: session.join_code, class_id: session.class_id
      }}
      participants={(parts ?? []).map((p: { id: string; user_id: string; status: string; joined_at: string }) => ({
        id: p.id, user_id: p.user_id, status: p.status, joined_at: p.joined_at
      }))}
      announcements={(anns ?? []).map((a: { id: string; body: string; created_at: string; user_id: string }) => ({ id: a.id, body: a.body, created_at: a.created_at, user_id: a.user_id }))}
      commands={(commands ?? []).map((c: { id: string; kind: string; target_student_id: string; state: string; created_at: string }) => ({
        id: c.id, kind: c.kind, target_student_id: c.target_student_id, state: c.state, created_at: c.created_at
      }))}
    />
  );
}
