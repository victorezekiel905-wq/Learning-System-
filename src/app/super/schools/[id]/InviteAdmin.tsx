"use client";
import { useState } from "react";
import { Button, CopyButton, Field, Input, Modal, Select, useToast } from "@/components/ui";
import { errorText, rpc } from "@/lib/rpc";

export function InviteAdmin({ tenantId }: { tenantId: string }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("school_admin");
  const [code, setCode] = useState<string | null>(null);
  return (
    <>
      <Button size="sm" onClick={() => { setOpen(true); setCode(null); }}>Invite staff</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Invite staff to this school"
        footer={code ? <Button onClick={() => setOpen(false)}>Done</Button> : <Button onClick={async () => {
          try { setCode(await rpc<string>("sa_invite_admin", { p_tenant: tenantId, p_email: email, p_role: role })); } catch (e) { toast(errorText(e), "error"); }
        }}>Create invite</Button>}>
        {code ? <div className="text-center"><p className="font-mono text-3xl font-extrabold tracking-[0.2em] text-brand-700">{code}</p><CopyButton value={code} /><p className="mt-2 text-xs text-ink-500">They sign up at /join with this code.</p></div> : (
          <div className="space-y-3">
            <Field label="Role"><Select value={role} onChange={(e) => setRole(e.target.value)}><option value="school_admin">School admin</option><option value="teacher">Teacher</option><option value="it_admin">IT admin</option></Select></Field>
            <Field label="Email (recommended)"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          </div>
        )}
      </Modal>
    </>
  );
}
