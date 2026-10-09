"use client";
import { useState } from "react";
import { Button, Card, Input, Select, useToast } from "@/components/ui";
import { useRpc } from "@/lib/hooks";
import { errorText, rpc } from "@/lib/rpc";

type Row = { id: string; subject: string; teacher_id: string; teacher: string };

/**
 * Who teaches which subject in this class. Subject teachers see the class and
 * their own subject's results; the class teacher and admins see every subject.
 */
export function SubjectTeachers({ classId, canManage, teachers }: { classId: string; canManage: boolean; teachers: { id: string; full_name: string }[] }) {
  const toast = useToast();
  const list = useRpc<Row[]>("class_subject_teachers", { p_class: classId }, [classId]);
  const [subject, setSubject] = useState("");
  const [teacher, setTeacher] = useState("");
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      await rpc("set_class_subject", { p_class: classId, p_subject: subject, p_teacher: teacher });
      setSubject(""); setTeacher("");
      await list.reload();
    } catch (e) { toast(errorText(e), "error"); }
    setBusy(false);
  }
  async function remove(r: Row) {
    try { await rpc("remove_class_subject", { p_id: r.id }); await list.reload(); toast(`${r.teacher} no longer teaches ${r.subject} here`, "success"); }
    catch (e) { toast(errorText(e), "error"); }
  }

  const rows = list.data ?? [];
  return (
    <Card title="Subject teachers">
      {rows.length === 0 ? (
        <p className="text-sm text-ink-500">{canManage ? "Add the teacher of each subject. They see this class and their own subject's results." : "No subject teachers yet."}</p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0"><span className="font-medium text-ink-900">{r.subject}</span> <span className="text-ink-500">· {r.teacher}</span></span>
              {canManage && <Button size="sm" variant="ghost" className="text-rose-700" onClick={() => remove(r)} aria-label={`Remove ${r.teacher} from ${r.subject}`}>Remove</Button>}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <div className="mt-4 space-y-2 border-t border-ink-100 pt-4">
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject, e.g. Mathematics" aria-label="Subject" maxLength={60} />
          <Select value={teacher} onChange={(e) => setTeacher(e.target.value)} aria-label="Teacher">
            <option value="">Choose the teacher…</option>
            {teachers.map((t) => <option key={t.id} value={t.id}>{t.full_name}</option>)}
          </Select>
          <Button size="sm" loading={busy} disabled={!subject.trim() || !teacher} onClick={add}>Add subject teacher</Button>
        </div>
      )}
    </Card>
  );
}
