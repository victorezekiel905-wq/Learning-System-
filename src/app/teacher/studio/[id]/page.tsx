import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SlideEditor from "@/components/studio/SlideEditor";

export default async function StudioLesson({ params }: { params: { id: string } }) {
  const sb = createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { data: lesson } = await sb
    .from("lessons").select("*").eq("id", params.id).maybeSingle();
  if (!lesson) {
    return <main className="mx-auto max-w-3xl px-6 py-12"><p className="text-slate-500">Lesson not found.</p></main>;
  }
  const { data: slides } = await sb
    .from("lesson_slides").select("*").eq("lesson_id", params.id).order("idx");

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <p className="text-sm font-medium text-brand-600">Editing</p>
          <h1 className="text-2xl font-semibold">{lesson.title}</h1>
        </div>
        <form action={`/api/lessons/${lesson.id}/publish`} method="POST">
          <button className="btn btn-primary" type="submit">{lesson.status === "published" ? "Republish" : "Publish"}</button>
        </form>
      </header>
      <SlideEditor lessonId={lesson.id} initialSlides={slides ?? []} />
    </main>
  );
}
