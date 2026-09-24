import { notFound } from "next/navigation";
import { requireRole } from "@/lib/session";
import { AssignmentView } from "./AssignmentView";

export const metadata = { title: "Assignment" };

export default async function StudentAssignment(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { me, sb } = await requireRole(["student"]);
  const { data: a } = await sb.from("assignments").select("id,title,instructions,due_at,allow_late,max_resubmissions,points_possible,activity_id,classes(name)").eq("id", params.id).maybeSingle();
  if (!a) notFound();
  const { data: subs } = await sb.from("submissions").select("id,attempt_no,body,files,status,is_late,submitted_at,grades(score,feedback,released_at,rubric_scores)").eq("assignment_id", params.id).order("attempt_no");
  return <AssignmentView assignment={a as never} submissions={(subs ?? []) as never} me={{ id: me.profile.id, tenantId: me.profile.tenant_id }} />;
}
