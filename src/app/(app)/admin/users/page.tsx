import { requireRole, ADMINS } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { UsersClient } from "./UsersClient";

export const metadata = { title: "People" };

export default async function UsersPage() {
  const { me, sb } = await requireRole(ADMINS);
  const [{ data: users }, { data: invites }, { data: students }] = await Promise.all([
    sb.from("users").select("id,full_name,email,role,status,created_at,last_seen_at").order("role").order("full_name").limit(5000),
    sb.from("invites").select("id,code,role,email,class_id,student_id,uses,max_uses,expires_at,revoked_at,created_at").order("created_at", { ascending: false }).limit(200),
    sb.from("users").select("id,full_name").eq("role", "student").order("full_name")
  ]);
  return (
    <div className="page">
      <PageHeader title="People" subtitle="Invite staff and parents, change roles, suspend accounts, and handle data requests." />
      <UsersClient users={users ?? []} invites={invites ?? []} students={students ?? []} meId={me.profile.id} />
    </div>
  );
}
