import { requireRole, STAFF } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { DevicesClient } from "./DevicesClient";

export const metadata = { title: "Devices" };

export default async function GuardPage() {
  const { me, sb } = await requireRole(STAFF);
  const isIt = ["it_admin", "school_admin", "platform_admin"].includes(me.profile.role);
  const [{ data: devices }, { data: students }] = await Promise.all([
    sb.from("devices").select("id,label,os,browser,agent_version,status,last_seen_at,enrolled_at,student_id,users:student_id(full_name)").order("last_seen_at", { ascending: false, nullsFirst: false }),
    sb.from("users").select("id,full_name,email").eq("role", "student").eq("status", "active").order("full_name").limit(2000)
  ]);
  return (
    <div className="page">
      <PageHeader eyebrow="SwiftCipher Guard" title="Devices" subtitle="School-managed browsers enrolled with the SwiftCipher extension. Monitoring only happens during live class sessions." />
      <DevicesClient devices={(devices ?? []) as never} students={students ?? []} isIt={isIt} appUrl={process.env.NEXT_PUBLIC_APP_URL ?? ""} />
    </div>
  );
}
