"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, Input, Modal } from "@/components/ui";
import { errorText, rpc } from "@/lib/rpc";

export function CreateClassButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setBusy(true); setErr(null);
    try {
      const cls = await rpc<{ id: string }>("create_class", { p_name: name, p_subject: subject || null, p_grade_level: grade || null });
      router.push(`/teacher/classes/${cls.id}`);
      router.refresh();
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>New class</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Create a class"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={busy} disabled={!name.trim()} onClick={create}>Create</Button></>}>
        <div className="space-y-4">
          <Field label="Class name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Year 8 ICT" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="ICT" /></Field>
            <Field label="Grade / year"><Input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="Year 8" /></Field>
          </div>
          {err && <Alert tone="error">{err}</Alert>}
        </div>
      </Modal>
    </>
  );
}
