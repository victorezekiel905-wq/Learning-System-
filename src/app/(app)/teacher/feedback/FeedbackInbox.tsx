"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, Empty, Select, Textarea, useToast } from "@/components/ui";
import type { FeedbackItem } from "@/components/parent/FeedbackPanel";
import { useRpc } from "@/lib/hooks";
import { errorText, rpc } from "@/lib/rpc";
import { formatDateTime } from "@/lib/utils";

export function FeedbackInbox({ admin }: { admin: boolean }) {
  const list = useRpc<FeedbackItem[]>("parent_feedback_list", {}, []);
  const [teacher, setTeacher] = useState("");
  const [open, setOpen] = useState<"all" | "waiting">("all");
  const items = useMemo(() => (list.data ?? [])
    .filter((f) => !teacher || f.teacher_id === teacher)
    .filter((f) => open === "all" || !f.reply), [list.data, teacher, open]);
  const teachers = useMemo(() => [...new Map((list.data ?? []).map((f) => [f.teacher_id, f.teacher])).entries()], [list.data]);

  if (list.error) return <Alert tone="error">{list.error}</Alert>;
  if (!list.data) return <p className="text-sm text-ink-500">Loading…</p>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Select className="!w-auto" value={open} onChange={(e) => setOpen(e.target.value as "all" | "waiting")} aria-label="Show">
          <option value="all">All feedback</option><option value="waiting">Waiting for a reply</option>
        </Select>
        {admin && teachers.length > 1 && (
          <Select className="!w-auto" value={teacher} onChange={(e) => setTeacher(e.target.value)} aria-label="Teacher">
            <option value="">Every teacher</option>{teachers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </Select>
        )}
      </div>
      {items.length === 0 ? <Empty title="No feedback here">When parents write about their children in {admin ? "a subject" : "your subjects"}, it appears here.</Empty>
        : items.map((f) => <Item key={f.id} f={f} onReplied={() => void list.reload()} />)}
    </div>
  );
}

function Item({ f, onReplied }: { f: FeedbackItem; onReplied: () => void }) {
  const toast = useToast();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true);
    try { await rpc("reply_parent_feedback", { p_feedback: f.id, p_reply: reply }); toast("Reply sent", "success"); onReplied(); }
    catch (e) { toast(errorText(e), "error"); }
    setBusy(false);
  }
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-ink-900">{f.parent} <span className="font-normal text-ink-500">about</span> <Link href={`/teacher/students/${f.student_id}`}>{f.student}</Link></p>
          <p className="text-[13px] text-ink-500">{f.subject}{!f.mine ? ` · to ${f.teacher}` : ""} · {formatDateTime(f.created_at)}</p>
        </div>
        {f.reply ? <Badge tone="green">Replied</Badge> : <Badge tone="amber">Waiting</Badge>}
      </div>
      <p className="mt-3 whitespace-pre-wrap text-[15px] text-ink-800">{f.body}</p>
      {f.reply ? (
        <p className="mt-3 whitespace-pre-wrap rounded-lg bg-brand-50 px-3 py-2 text-sm text-ink-800"><span className="font-semibold">{f.teacher}: </span>{f.reply}</p>
      ) : f.mine ? (
        <div className="mt-3 space-y-2">
          <Textarea rows={2} maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Your reply to the parent" aria-label="Reply" />
          <Button size="sm" loading={busy} disabled={!reply.trim()} onClick={send}>Send reply</Button>
        </div>
      ) : null}
    </Card>
  );
}
