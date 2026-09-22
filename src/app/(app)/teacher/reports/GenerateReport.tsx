"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field, Modal, Select, useToast } from "@/components/ui";
import { api, errorText } from "@/lib/rpc";

export function GenerateReport({ classes }: { classes: { id: string; name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("class_analytics");
  const [cls, setCls] = useState(classes[0]?.id ?? "");
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Generate report</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Generate report"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} onClick={async () => {
          setBusy(true);
          try { const r = await api<{ id: string }>("/api/reports", { method: "POST", json: { kind, class_id: cls, days } }); router.push(`/teacher/reports?id=${r.id}`); setOpen(false); }
          catch (e) { toast(errorText(e), "error"); }
          setBusy(false);
        }}>Generate</Button></>}>
        <div className="space-y-3">
          <Field label="Report"><Select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="class_analytics">Class analytics</option><option value="attendance">Attendance register</option><option value="tenant_overview">School overview (admins)</option>
          </Select></Field>
          {kind !== "tenant_overview" && <Field label="Class"><Select value={cls} onChange={(e) => setCls(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>}
          <Field label="Period"><Select value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option><option value={365}>1 year</option></Select></Field>
        </div>
      </Modal>
    </>
  );
}
