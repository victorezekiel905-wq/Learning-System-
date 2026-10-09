"use client";
import { useEffect, useState } from "react";
import { Alert, Button, Card, Field, Select, Textarea, useToast } from "@/components/ui";
import { useRpc } from "@/lib/hooks";
import { errorText, rpc } from "@/lib/rpc";
import { formatDateTime } from "@/lib/utils";

type Target = { class_id: string; subject: string; class: string; teacher_id: string; teacher: string };
export type FeedbackItem = {
  id: string; student_id: string; student: string; parent: string; teacher_id: string; teacher: string; class_id: string | null;
  subject: string; body: string; created_at: string; read_at: string | null; reply: string | null; replied_at: string | null; mine: boolean;
};

/** A parent writes to the teacher of one of their child's subjects, and sees the replies. */
export function FeedbackPanel({ studentId, name }: { studentId: string; name: string }) {
  const toast = useToast();
  const targets = useRpc<Target[]>("feedback_targets", { p_student: studentId }, [studentId]);
  const list = useRpc<FeedbackItem[]>("parent_feedback_list", { p_student: studentId }, [studentId]);
  const [cls, setCls] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const first = name.split(" ")[0];
  // A choice is a class and a teacher: the class teacher, or one of its subject teachers.
  useEffect(() => { if (!cls && targets.data?.[0]) setCls(`${targets.data[0].class_id}|${targets.data[0].teacher_id}`); }, [targets.data, cls]);

  async function send() {
    setBusy(true);
    try {
      const [classId, teacherId] = cls.split("|");
      await rpc("send_parent_feedback", { p_student: studentId, p_class: classId, p_body: body, p_teacher: teacherId });
      setBody("");
      toast("Sent to the teacher", "success");
      await list.reload();
    } catch (e) { toast(errorText(e), "error"); }
    setBusy(false);
  }

  const t = targets.data ?? [];
  return (
    <Card title="Feedback to teachers">
      {t.length === 0 ? <p className="text-sm text-ink-500">{first} isn&apos;t in any classes yet.</p> : (
        <div className="space-y-3">
          <Field label="Subject" htmlFor="fb-class">
            <Select id="fb-class" value={cls} onChange={(e) => setCls(e.target.value)}>
              {t.map((x) => <option key={`${x.class_id}|${x.teacher_id}|${x.subject}`} value={`${x.class_id}|${x.teacher_id}`}>{x.subject} · {x.teacher}</option>)}
            </Select>
          </Field>
          <Field label="Your feedback" hint="Only this teacher and the school's leaders can read it." htmlFor="fb-body">
            <Textarea id="fb-body" rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)}
              placeholder={`How ${first} is finding the subject, something to know at home, or a question.`} />
          </Field>
          <Button loading={busy} disabled={body.trim().length < 2 || !cls} onClick={send}>Send</Button>
        </div>
      )}
      {(list.data ?? []).length > 0 && (
        <ul className="mt-5 space-y-3 border-t border-ink-100 pt-4">
          {list.data!.map((f) => (
            <li key={f.id} className="text-sm">
              <p className="text-[12px] font-semibold text-ink-500">{f.subject} · {f.teacher} · {formatDateTime(f.created_at)}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-ink-800">{f.body}</p>
              {f.reply ? (
                <p className="mt-2 whitespace-pre-wrap rounded-lg bg-brand-50 px-3 py-2 text-ink-800"><span className="font-semibold">{f.teacher}: </span>{f.reply}</p>
              ) : <p className="mt-1 text-[12px] text-ink-500">{f.read_at ? "Read by the teacher" : "Sent"}</p>}
            </li>
          ))}
        </ul>
      )}
      {list.error && <Alert tone="error">{list.error}</Alert>}
    </Card>
  );
}
