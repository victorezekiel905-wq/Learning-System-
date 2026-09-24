"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, CopyButton, Field, Input, Modal, Select, Tabs, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { api, errorText, rpc } from "@/lib/rpc";
import { ROLE_LABEL, type Role } from "@/lib/types";
import { formatDate, timeAgo } from "@/lib/utils";

type U = { id: string; full_name: string; email: string; role: Role; status: string; created_at: string; last_seen_at: string | null };
type Inv = { id: string; code: string; role: Role; email: string | null; uses: number; max_uses: number; expires_at: string; revoked_at: string | null; created_at: string };

export function UsersClient({ users, total, page, pageSize, q, role, invites, meId }: {
  users: U[]; total: number; page: number; pageSize: number; q: string; role: string; invites: Inv[]; meId: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<"people" | "invites">("people");
  const [invite, setInvite] = useState(false);
  const rows = users;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => `/admin/users?${new URLSearchParams({ ...(q && { q }), ...(role && { role }), ...(p > 1 && { page: String(p) }) })}`;

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
        <Tabs value={tab} onChange={setTab} tabs={[{ id: "people", label: `People (${total.toLocaleString()})` }, { id: "invites", label: `Invites (${invites.filter((i) => !i.revoked_at && new Date(i.expires_at) > new Date() && i.uses < i.max_uses).length} active)` }]} />
        <Button onClick={() => setInvite(true)}>Invite people</Button>
      </div>

      {tab === "people" && (
        <>
          <form className="flex flex-wrap gap-2" action="/admin/users">
            <Input name="q" placeholder="Search name or email" defaultValue={q} className="w-full sm:max-w-xs" />
            <Select name="role" className="w-full sm:w-44" defaultValue={role} onChange={(e) => e.currentTarget.form?.requestSubmit()}><option value="">All roles</option>{Object.entries(ROLE_LABEL).filter(([k]) => k !== "platform_admin").map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
            <Button type="submit" variant="secondary">Search</Button>
          </form>
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
          {rows.length === 0 && <p className="text-sm text-ink-500">No one matches.</p>}
          <nav className="flex items-center justify-between text-sm" aria-label="Pages">
            <span className="text-ink-500">Page {page} of {pages.toLocaleString()}</span>
            <span className="flex gap-2">
              {page > 1 && <Link href={href(page - 1)} className="btn btn-secondary btn-sm no-underline">← Previous</Link>}
              {page < pages && <Link href={href(page + 1)} className="btn btn-secondary btn-sm no-underline">Next →</Link>}
            </span>
          </nav>
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

      {invite && <InviteModal onClose={() => { setInvite(false); router.refresh(); }} />}
    </div>
  );
}

/** Type-to-search picker: works the same for 30 students or 30,000. */
function StudentPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<{ id: string; full_name: string; email: string }[]>([]);
  useEffect(() => {
    const term = q.trim().replace(/[%_,()*]/g, " ");
    if (term.length < 2) { setOptions([]); return; }
    const t = window.setTimeout(async () => {
      const { data } = await createClient().from("users").select("id,full_name,email").eq("role", "student")
        .or(`full_name.ilike.*${term}*,email.ilike.*${term}*`).order("full_name").limit(20);
      setOptions(data ?? []);
    }, 250);
    return () => window.clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-2">
      <Input placeholder="Type at least 2 letters of the student's name or email" value={q} onChange={(e) => setQ(e.target.value)} />
      {options.length > 0 && (
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose…</option>
          {options.map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.email})</option>)}
        </Select>
      )}
    </div>
  );
}

function InviteModal({ onClose }: { onClose: () => void }) {
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
          {role === "parent" && <Field label="Student"><StudentPicker value={student} onChange={setStudent} /></Field>}
          <Field label="Email (recommended)" hint="The invite then only works for this address, and we'll email it if email is set up."><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {!email && <Field label="How many people can use it"><Input type="number" min={1} max={200} value={uses} onChange={(e) => setUses(Number(e.target.value))} /></Field>}
          {role === "school_admin" && <Alert tone="warn">Administrators can see and change everything in your school.</Alert>}
        </div>
      )}
    </Modal>
  );
}
