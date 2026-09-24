"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Alert, Badge, Button, CopyButton, Field, Input, Modal, Select, Tabs, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { api, errorText, rpc } from "@/lib/rpc";
import { ROLE_LABEL, type Role } from "@/lib/types";
import { formatDate, timeAgo } from "@/lib/utils";

type U = { id: string; full_name: string; email: string; role: Role; status: string; created_at: string; last_seen_at: string | null };
type Inv = { id: string; code: string; role: Role; email: string | null; uses: number; max_uses: number; expires_at: string; revoked_at: string | null; created_at: string };

export function UsersClient({ users, invites, students, meId }: { users: U[]; invites: Inv[]; students: { id: string; full_name: string }[]; meId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<"people" | "invites">("people");
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [invite, setInvite] = useState(false);
  const rows = useMemo(() => users.filter((u) => (!role || u.role === role) && (!q || `${u.full_name} ${u.email}`.toLowerCase().includes(q.toLowerCase()))), [users, q, role]);

  async function call(fn: string, args: Record<string, unknown>, msg: string) {
    try { await rpc(fn, args); toast(msg, "success"); router.refresh(); } catch (e) { toast(errorText(e), "error"); }
  }
  async function exportData(u: U) {
    try {
      const data = await rpc("export_user_data", { p_user: u.id });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `swiftcipher-export-${u.email}.json`; a.click();
    } catch (e) { toast(errorText(e), "error"); }
  }
  async function remove(u: U) {
    if (prompt(`This permanently deletes ${u.full_name}'s account and data. Type DELETE to confirm.`) !== "DELETE") return;
    try { await api(`/api/admin/users/${u.id}`, { method: "DELETE" }); toast("Deleted", "success"); router.refresh(); } catch (e) { toast(errorText(e), "error"); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "people", label: `People (${users.length})` }, { id: "invites", label: `Invites (${invites.filter((i) => !i.revoked_at && new Date(i.expires_at) > new Date() && i.uses < i.max_uses).length} active)` }]} />
        <Button onClick={() => setInvite(true)}>Invite people</Button>
      </div>

      {tab === "people" && (
        <>
          <div className="flex gap-2"><Input placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
            <Select className="w-44" value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{Object.entries(ROLE_LABEL).filter(([k]) => k !== "platform_admin").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
          <div className="card overflow-x-auto"><table className="table">
            <thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Joined</th><th>Last seen</th><th className="text-right">Actions</th></tr></thead>
            <tbody>{rows.map((u) => (
              <tr key={u.id}>
                <td><p className="font-medium">{u.full_name}</p><p className="text-xs text-ink-500">{u.email}</p></td>
                <td>{u.id === meId ? <Badge tone="brand">{ROLE_LABEL[u.role]}</Badge> : (
                  <Select className="py-1 text-xs" value={u.role} onChange={(e) => call("admin_set_user_role", { p_user: u.id, p_role: e.target.value }, "Role updated")}>
                    {(["student", "teacher", "it_admin", "school_admin", "parent"] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </Select>)}</td>
                <td><Badge tone={u.status === "active" ? "green" : "red"}>{u.status}</Badge></td>
                <td className="text-xs text-ink-500">{formatDate(u.created_at)}</td>
                <td className="text-xs text-ink-500">{timeAgo(u.last_seen_at)}</td>
                <td className="text-right"><div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => exportData(u)}>Export</Button>
                  {u.id !== meId && (u.status === "active"
                    ? <Button size="sm" variant="ghost" onClick={() => call("admin_set_user_status", { p_user: u.id, p_status: "suspended" }, "Suspended")}>Suspend</Button>
                    : <Button size="sm" variant="ghost" onClick={() => call("admin_set_user_status", { p_user: u.id, p_status: "active" }, "Reactivated")}>Reactivate</Button>)}
                  {u.id !== meId && <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => remove(u)}>Delete</Button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table></div>
        </>
      )}

      {tab === "invites" && (
        <div className="card overflow-x-auto"><table className="table">
          <thead><tr><th>Code</th><th>Role</th><th>For</th><th>Uses</th><th>Expires</th><th /></tr></thead>
          <tbody>{invites.map((i) => {
            const dead = !!i.revoked_at || new Date(i.expires_at) < new Date() || i.uses >= i.max_uses;
            return (
              <tr key={i.id} className={dead ? "opacity-50" : ""}><td className="font-mono">{i.code}</td><td>{ROLE_LABEL[i.role]}</td><td className="text-xs">{i.email ?? "anyone with the code"}</td>
                <td>{i.uses}/{i.max_uses}</td><td className="text-xs">{formatDate(i.expires_at)}</td>
                <td className="text-right">{!dead && <><CopyButton value={i.code} /><Button size="sm" variant="ghost" onClick={async () => { await createClient().from("invites").update({ revoked_at: new Date().toISOString() }).eq("id", i.id); router.refresh(); }}>Revoke</Button></>}</td></tr>
            );
          })}</tbody>
        </table></div>
      )}

      {invite && <InviteModal students={students} onClose={() => { setInvite(false); router.refresh(); }} />}
    </div>
  );
}

function InviteModal({ students, onClose }: { students: { id: string; full_name: string }[]; onClose: () => void }) {
  const toast = useToast();
  const [role, setRole] = useState<Role>("teacher");
  const [email, setEmail] = useState("");
  const [student, setStudent] = useState("");
  const [uses, setUses] = useState(1);
  const [code, setCode] = useState<string | null>(null);
  const [emailed, setEmailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const r = await api<{ code: string; emailed: boolean }>("/api/admin/invites", { method: "POST", json: { role, email: email || null, student_id: role === "parent" ? student : null, max_uses: uses } });
      setCode(r.code); setEmailed(r.emailed);
    } catch (e) { toast(errorText(e), "error"); }
    setBusy(false);
  }

  return (
    <Modal open onClose={onClose} title="Invite people" footer={code ? <Button onClick={onClose}>Done</Button> : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={role === "parent" && !student} onClick={create}>Create invite</Button></>}>
      {code ? (
        <div className="space-y-3 text-center">
          <p className="font-mono text-4xl font-extrabold tracking-[0.2em] text-brand-700">{code}</p><CopyButton value={code} />
          <p className="text-sm text-ink-600">{emailed ? `An invitation email was sent to ${email}.` : "Share this code. They sign up at /join."} It expires in 14 days.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="Role"><Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="teacher">Teacher</option><option value="it_admin">IT / device admin</option><option value="school_admin">School administrator</option><option value="parent">Parent / guardian</option>
          </Select></Field>
          {role === "parent" && <Field label="Student"><Select value={student} onChange={(e) => setStudent(e.target.value)}><option value="">Choose…</option>{students.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</Select></Field>}
          <Field label="Email (recommended)" hint="The invite then only works for this address, and we'll email it if email is set up."><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {!email && <Field label="How many people can use it"><Input type="number" min={1} max={200} value={uses} onChange={(e) => setUses(Number(e.target.value))} /></Field>}
          {role === "school_admin" && <Alert tone="warn">Administrators can see and change everything in your school.</Alert>}
        </div>
      )}
    </Modal>
  );
}
