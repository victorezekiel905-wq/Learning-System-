import { requireRole } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { DeviceClient } from "./DeviceClient";

export const metadata = { title: "This device" };

export default async function StudentDevicePage() {
  const { me, sb } = await requireRole(["student"]);
  const [{ data: devices }, { data: sessions }, { data: events }] = await Promise.all([
    sb.from("devices").select("id,label,os,browser,status,last_seen_at,enrolled_at").eq("student_id", me.profile.id).order("enrolled_at", { ascending: false }),
    sb.from("browser_sessions").select("id,active_domain,active_title,tab_count,idle_state,last_heartbeat_at,class_sessions(title)").eq("student_id", me.profile.id).order("last_heartbeat_at", { ascending: false }).limit(5),
    sb.from("environment_events").select("id,kind,rule,created_at,status").eq("student_id", me.profile.id).order("created_at", { ascending: false }).limit(10)
  ]);
  return (
    <div className="page max-w-4xl">
      <PageHeader title="This device" subtitle="Pair your school browser and see exactly what it shares with your teacher." />
      <DeviceClient devices={devices ?? []} sessions={(sessions ?? []) as never} events={events ?? []} notice={me.settings?.monitoring_notice ?? ""} />
    </div>
  );
}
