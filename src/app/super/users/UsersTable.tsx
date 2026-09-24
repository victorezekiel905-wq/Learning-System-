"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Select, useToast } from "@/components/ui";
import { api, errorText, rpc } from "@/lib/rpc";
import { formatDate } from "@/lib/utils";

export type SaUser = { id: string; full_name: string; email: string; role: string; status: string; created_at: string; tenant: string; tenant_id: string; tenant_status: string };

const ROLES = ["student", "teacher", "it_admin", "school_admin", "parent"];

export function UsersTable({ users, hideTenant }: { users: SaUser[]; hideTenant?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  async function act(fn: string, args: Record<string, unknown>, msg: string) {
    try { await rpc(fn, args); toast(msg, "success"); router.refresh(); } catch (e) { toast(errorText(e), "error"); }
  }
  if (!users.length) return <p className="p-5 text-sm text-ink-500">No users.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead><tr><th>Name</th>{!hideTenant && <th>School</th>}<th>Role</th><th>Status</th><th>Joined</th><th className="text-right">Actions</th></tr></thead>
        <tbody>{users.map((u) => (
          <tr key={u.id}>
            <td><p className="font-medium">{u.full_name}</p><p className="text-xs text-ink-500">{u.email}</p></td>
            {!hideTenant && <td className="text-sm"><Link href={`/super/schools/${u.tenant_id}`}>{u.tenant}</Link>{u.tenant_status !== "active" && <Badge tone="red" className="ml-1">suspended</Badge>}</td>}
            <td><Select aria-label={`Role for ${u.full_name}`} className="py-1 text-xs" value={u.role} onChange={(e) => act("sa_set_user_role", { p_user: u.id, p_role: e.target.value }, "Role changed")}>
              {ROLES.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}</Select></td>
            <td><Badge tone={u.status === "active" ? "green" : "red"}>{u.status}</Badge></td>
            <td className="text-xs text-ink-500">{formatDate(u.created_at)}</td>
            <td className="text-right"><div className="flex justify-end gap-1">
              {u.status === "active"
                ? <Button size="sm" variant="ghost" onClick={() => act("sa_set_user_status", { p_user: u.id, p_status: "suspended" }, "User suspended")}>Suspend</Button>
                : <Button size="sm" variant="ghost" onClick={() => act("sa_set_user_status", { p_user: u.id, p_status: "active" }, "Suspension lifted")}>Lift suspension</Button>}
              <Button size="sm" variant="ghost" className="text-rose-600" onClick={async () => {
                if (prompt(`Permanently delete ${u.full_name} (${u.email}) and their login? Type DELETE:`) !== "DELETE") return;
                try { await api(`/api/super/users/${u.id}`, { method: "DELETE" }); toast("User deleted", "success"); router.refresh(); } catch (e) { toast(errorText(e), "error"); }
              }}>Delete</Button>
            </div></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}
