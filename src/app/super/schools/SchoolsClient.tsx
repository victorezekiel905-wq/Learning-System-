"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Badge, Button, CopyButton, Field, Input, Modal, Select, useToast } from "@/components/ui";
import { api, errorText, rpc } from "@/lib/rpc";
import { formatDate } from "@/lib/utils";

export type TenantRow = {
  id: string; name: string; slug: string; plan_code: string; status: "active" | "suspended"; country: string | null;
  created_at: string; suspended_reason: string | null; users: number; students: number; staff: number; classes: number; devices: number; last_session_at: string | null;
};

export function SchoolsClient({ tenants, plans, q, openNew }: { tenants: TenantRow[]; plans: { code: string; name: string }[]; q: string; openNew: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [creating, setCreating] = useState(openNew);
  const [deleting, setDeleting] = useState<TenantRow | null>(null);

  async function act(fn: string, args: Record<string, unknown>, msg: string) {
    try { await rpc(fn, args); toast(msg, "success"); router.refresh(); } catch (e) { toast(errorText(e), "error"); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <form className="flex gap-2"><input name="q" defaultValue={q} placeholder="Search schools" className="input w-64" /><button className="btn btn-secondary">Search</button></form>
        <Button onClick={() => setCreating(true)}>Create school</Button>
      </div>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead><tr><th>School</th><th>Plan</th><th>Status</th><th>People</th><th>Classes</th><th>Devices</th><th>Created</th><th className="text-right">Actions</th></tr></thead>
          <tbody>{tenants.map((t) => (
            <tr key={t.id}>
              <td><Link href={`/super/schools/${t.id}`} className="font-medium">{t.name}</Link><p className="text-xs text-ink-500">{t.slug}{t.country && ` · ${t.country}`}</p></td>
              <td><Select aria-label={`Plan for ${t.name}`} className="py-1 text-xs" value={t.plan_code} onChange={(e) => act("sa_update_tenant", { p_tenant: t.id, p_plan: e.target.value }, "Plan changed")}>
                {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</Select></td>
              <td>{t.status === "active" ? <Badge tone="green">active</Badge> : <Badge tone="red" >suspended</Badge>}{t.suspended_reason && <p className="text-[11px] text-ink-500">{t.suspended_reason}</p>}</td>
              <td className="text-xs">{t.staff} staff · {t.students} students</td>
              <td>{t.classes}</td><td>{t.devices}</td>
              <td className="text-xs text-ink-500">{formatDate(t.created_at)}</td>
              <td className="text-right"><div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={async () => { const name = prompt("New name", t.name); if (name && name !== t.name) await act("sa_update_tenant", { p_tenant: t.id, p_name: name }, "Renamed"); }}>Rename</Button>
                {t.status === "active"
                  ? <Button size="sm" variant="ghost" onClick={async () => { const reason = prompt(`Suspend ${t.name}? Everyone in this school will be locked out.\nReason (optional):`); if (reason !== null) await act("sa_set_tenant_status", { p_tenant: t.id, p_status: "suspended", p_reason: reason }, "School suspended"); }}>Suspend</Button>
                  : <Button size="sm" variant="ghost" onClick={() => act("sa_set_tenant_status", { p_tenant: t.id, p_status: "active" }, "School restored")}>Restore</Button>}
                <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => setDeleting(t)}>Delete</Button>
              </div></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {creating && <CreateSchool plans={plans} onClose={() => { setCreating(false); router.refresh(); }} />}
      {deleting && <DeleteSchool t={deleting} onClose={() => { setDeleting(null); router.refresh(); }} />}
    </div>
  );
}

function CreateSchool({ plans, onClose }: { plans: { code: string; name: string }[]; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", plan: "free_teacher", country: "", email: "" });
  const [done, setDone] = useState<{ tenant_id: string; admin_invite_code: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="Create a school" footer={done ? <Button onClick={onClose}>Done</Button> : <><Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button loading={busy} disabled={!f.name.trim()} onClick={async () => {
        setBusy(true);
        try { setDone(await rpc("sa_create_tenant", { p_name: f.name, p_plan: f.plan, p_country: f.country || null, p_admin_email: f.email || null })); }
        catch (e) { toast(errorText(e), "error"); }
        setBusy(false);
      }}>Create</Button></>}>
      {done ? (
        <div className="space-y-3">
          <Alert tone="success">School created.</Alert>
          {done.admin_invite_code ? <div className="text-center"><p className="text-sm">Admin invite code for {f.email}:</p>
            <p className="my-2 font-mono text-3xl font-extrabold tracking-[0.2em] text-brand-700">{done.admin_invite_code}</p><CopyButton value={done.admin_invite_code} />
            <p className="mt-2 text-xs text-ink-500">They sign up at /join with this code (valid 30 days, one use).</p></div>
            : <p className="text-sm">No admin yet. Open the school to invite one.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <Field label="School name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Plan"><Select value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}>{plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</Select></Field>
            <Field label="Country"><Input value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} /></Field>
          </div>
          <Field label="School admin's email (optional)" hint="Creates a one-time admin invite code tied to this email."><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        </div>
      )}
    </Modal>
  );
}

function DeleteSchool({ t, onClose }: { t: TenantRow; onClose: () => void }) {
  const toast = useToast();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={`Delete ${t.name}`} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="danger" loading={busy} disabled={confirm !== t.name} onClick={async () => {
        setBusy(true);
        try { await api(`/api/super/tenants/${t.id}`, { method: "DELETE", json: { confirm_name: confirm } }); toast("School deleted", "success"); onClose(); }
        catch (e) { toast(errorText(e), "error"); setBusy(false); }
      }}>Delete permanently</Button></>}>
      <Alert tone="error" title="This cannot be undone">Deletes the school, its {t.users} user accounts (including their logins), classes, lessons, grades, devices and all other data.</Alert>
      <Field className="mt-4" label={`Type "${t.name}" to confirm`}><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
    </Modal>
  );
}
