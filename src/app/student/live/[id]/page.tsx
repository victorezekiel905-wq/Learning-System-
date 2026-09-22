import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import StudentSession from "@/components/student/StudentSession";

export default async function StudentLive({ params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/student/join");

  const { data: session } = await sb.from("class_sessions").select("*").eq("id", params.id).maybeSingle();
  if (!session) return <main className="mx-auto max-w-3xl px-6 py-12">Session not found.</main>;

  const { data: lesson } = session.lesson_id
    ? (await sb.from("lessons").select("id,title,mode").eq("id", session.lesson_id).maybeSingle())
    : { data: null };

  return (
    <StudentSession
      session={{
        id: session.id, state: session.state, mode: session.mode,
        join_code: session.join_code, class_id: session.class_id
      }}
      lessonId={session.lesson_id ?? null}
      lessonTitle={lesson?.title ?? null}
      studentId={user.id}
    />
  );
}
