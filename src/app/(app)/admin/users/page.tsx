import { requireRole, ADMINS } from "@/lib/session";
import { PageHeader } from "@/components/ui";
import { UsersClient } from "./UsersClient";

export const metadata = { title: "People" };

const PAGE = 100;

export default async function UsersPage(props: { searchParams: Promise<{ q?: string; role?: string; page?: string }> }) {
  const sp = await props.searchParams;
  const { me, sb } = await requireRole(ADMINS);
  const page = Math.max(1, Number(sp.page) || 1);
  const q = (sp.q ?? "").trim().slice(0, 100);
  // Search and paging run in the database, so a school with 50,000 people loads as fast as one with 50.
  let users = sb.from("users").select("id,full_name,email,role,status,created_at,last_seen_at", { count: "exact" });
  if (sp.role) users = users.eq("role", sp.role);
  if (q) {
    const safe = q.replace(/[%_,()*]/g, " ");
    users = users.or(`full_name.ilike.*${safe}*,email.ilike.*${safe}*`);
  }
  const [{ data: rows, count }, { data: invites }] = await Promise.all([
    users.order("full_name").order("id").range((page - 1) * PAGE, page * PAGE - 1),
    sb.from("invites").select("id,code,role,email,class_id,student_id,uses,max_uses,expires_at,revoked_at,created_at").order("created_at", { ascending: false }).limit(200)
  ]);
  return (
    <div className="page">
      <PageHeader title="People" subtitle="Invite staff and parents, change roles, suspend accounts, and handle data requests." />
      <UsersClient users={rows ?? []} total={count ?? 0} page={page} pageSize={PAGE} q={q} role={sp.role ?? ""}
        invites={invites ?? []} meId={me.profile.id} />
    </div>
  );
}
