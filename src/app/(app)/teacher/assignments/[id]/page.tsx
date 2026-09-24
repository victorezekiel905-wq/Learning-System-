import { notFound } from "next/navigation";
import { requireRole, TEACHERS } from "@/lib/session";
import { AssignmentGrader } from "./AssignmentGrader";

export const metadata = { title: "Assignment" };

export default async function AssignmentPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { sb } = await requireRole(TEACHERS);
  const { data: a } = await sb.from("assignments").select("*,classes(name),rubrics(id,title,criteria)").eq("id", params.id).maybeSingle();
  if (!a) notFound();
  const [{ data: subs }, { data: roster }] = await Promise.all([
    sb.from("submissions").select("id,student_id,attempt_no,body,files,status,is_late,submitted_at,attempt_id,users(full_name),grades(score,feedback,released_at,rubric_scores),quiz_attempts(score,max_score,status)")
      .eq("assignment_id", params.id).order("submitted_at", { ascending: false }),
    sb.from("class_members").select("user_id,users(full_name)").eq("class_id", a.class_id).eq("role", "student")
  ]);
  return <AssignmentGrader assignment={a as never} submissions={(subs ?? []) as never} roster={(roster ?? []) as never} />;
}
