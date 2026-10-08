"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Select, useDialog, useToast } from "@/components/ui";
import { api, errorText, rpc } from "@/lib/rpc";
import { DeleteSchool } from "../SchoolsClient";

/** Plan, suspend/restore, settings and delete for one school, on its own page. */
export function SchoolControls({ tenant, plans, users }: {
  tenant: { id: string; name: string; plan_code: string; status: string };
  plans: { code: string; name: string }[];
  users: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const dialog = useDialog();
  const [deleting, setDeleting] = useState(false);

  async function act(fn: string, args: Record<string, unknown>, msg: string) {
    try { await rpc(fn, args); toast(msg, "success"); router.refresh(); } catch (e) { toast(errorText(e), "error"); }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label={`Plan for ${tenant.name}`} className="h-8 w-auto py-0 text-[13px]" value={tenant.plan_code}
        onChange={(e) => act("sa_update_tenant", { p_tenant: tenant.id, p_plan: e.target.value }, "Plan changed")}>
        {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
      </Select>
      <Link href={`/super/schools/${tenant.id}/settings`} className="btn btn-secondary btn-sm no-underline">Settings</Link>
      {tenant.status === "active" && <Button size="sm" onClick={async () => {
        if (!(await dialog.confirm({ title: `Open ${tenant.name} as its admin?`, body: "You'll use the school's own admin screens as \"SwiftCipher support\". The school's audit log shows SwiftCipher support; the platform log records that it was you. Use \"Return to platform console\" to come back.", confirmLabel: "Open as admin" }))) return;
        try { const r = await api<{ redirect: string }>(`/api/super/tenants/${tenant.id}/enter`, { method: "POST" }); window.location.assign(new URL(r.redirect, window.location.origin)); }
        catch (e) { toast(errorText(e), "error"); }
      }}>Open as admin</Button>}
      {tenant.status === "active"
        ? <Button size="sm" variant="secondary" onClick={async () => {
            const reason = await dialog.ask({ title: `Suspend ${tenant.name}?`, body: "Everyone in this school is locked out and live lessons end until you restore it. No data is deleted.",
              label: "Reason (optional)", optional: true, tone: "danger", confirmLabel: "Suspend school" });
            if (reason !== null) await act("sa_set_tenant_status", { p_tenant: tenant.id, p_status: "suspended", p_reason: reason }, "School suspended");
          }}>Suspend</Button>
        : <Button size="sm" onClick={() => act("sa_set_tenant_status", { p_tenant: tenant.id, p_status: "active" }, "School restored")}>Restore</Button>}
      <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => setDeleting(true)}>Delete</Button>
      {deleting && <DeleteSchool t={{ id: tenant.id, name: tenant.name, users }} onClose={(deleted) => {
        setDeleting(false);
        if (deleted) router.push("/super/schools"); else router.refresh();
      }} />}
    </div>
  );
}
