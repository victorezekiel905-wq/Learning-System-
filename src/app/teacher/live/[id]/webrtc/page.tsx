import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WebRtcMesh from "@/components/live/WebRtcMesh";

export default async function TeacherWebRtcPage({ params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { data: me } = await sb.from("users").select("role").eq("id", user.id).maybeSingle();
  if (!me || !["teacher", "school_admin", "it_admin", "platform_admin"].includes(me.role)) redirect("/dashboard");

  const { data: session } = await sb.from("class_sessions").select("id").eq("id", params.id).maybeSingle();
  if (!session) return <main className="mx-auto max-w-3xl px-6 py-12">Session not found.</main>;

  return (
    <WebRtcMesh
      sessionId={session.id}
      roleLabel="teacher"
      canHost={true}
      backHref={`/teacher/live/${session.id}`}
      backLabel="Back to live room"
    />
  );
}
