import { requireRole, TEACHERS } from "@/lib/session";
import { TeacherHomeView, type TeacherHomeData } from "./TeacherHomeView";

export const metadata = { title: "Dashboard" };

export default async function TeacherHome() {
  const { me, sb } = await requireRole(TEACHERS);
  const uid = me.profile.id;

  const monthStart = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [classes, live, lessons, monthSessions, alerts, recent, lessonCount, feedback, everTaught] = await Promise.all([
    sb.from("classes").select("id,name,subject,join_code").is("archived_at", null).order("created_at"),
    sb.from("class_sessions").select("id,title,join_code,started_at,class_id").eq("status", "live").eq("is_homework", false).eq("teacher_id", uid),
    sb.from("lessons").select("id,title,status,updated_at").eq("owner_id", uid).order("updated_at", { ascending: false }).limit(5),
    sb.from("class_sessions").select("id", { count: "exact", head: true }).eq("teacher_id", uid).gte("created_at", monthStart),
    sb.from("environment_events").select("id,kind,rule,created_at,class_session_id,student_id").eq("status", "open").order("created_at", { ascending: false }).limit(5),
    sb.from("class_sessions").select("id,title,ended_at").eq("teacher_id", uid).eq("status", "ended").order("ended_at", { ascending: false }).limit(5),
    sb.from("lessons").select("id", { count: "exact", head: true }).eq("owner_id", uid),
    sb.from("parent_feedback").select("id", { count: "exact", head: true }).eq("teacher_id", uid).is("reply", null),
    sb.from("class_sessions").select("id", { count: "exact", head: true }).eq("teacher_id", uid)
  ]);

  return <TeacherHomeView d={{
    school: me.tenant?.name ?? null, timezone: me.tenant?.timezone, name: me.profile.full_name, welcome: me.settings?.welcome_message ?? null,
    classes: (classes.data ?? []) as TeacherHomeData["classes"], live: (live.data ?? []) as TeacherHomeData["live"],
    lessons: (lessons.data ?? []) as TeacherHomeData["lessons"], sessions30: monthSessions.count ?? 0,
    openAlerts: (alerts.data ?? []).length, recent: (recent.data ?? []) as TeacherHomeData["recent"],
    lessonCount: lessonCount.count ?? undefined, feedbackWaiting: feedback.count ?? 0, monitoring: !!me.settings?.monitoring_enabled,
    guide: { classes: (classes.data ?? []).length > 0, lessons: (lessonCount.count ?? 0) > 0, taught: (everTaught.count ?? 0) > 0, report: (recent.data ?? []).length > 0 }
  }} />;
}
