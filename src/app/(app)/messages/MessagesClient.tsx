"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ThreadView } from "@/components/chat/ThreadView";
import { Avatar, Button, Card, Empty, Field, Select, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useLoader } from "@/lib/hooks";
import { errorText, rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";

type Thread = {
  id: string; kind?: "direct" | "parent"; class_id: string; student_id: string; teacher_id: string; parent_id?: string | null;
  classes: { name: string } | null; student: { full_name: string } | null; teacher: { full_name: string } | null; parent?: { full_name: string } | null;
};

/** Who the conversation is with, from the viewer's side. Parent threads name the child they're about. */
function withWhom(t: Thread, meId: string) {
  if (t.kind === "parent") {
    return meId === t.parent_id
      ? { name: t.teacher?.full_name ?? "Teacher", sub: `about ${t.student?.full_name ?? "your child"} · ${t.classes?.name ?? ""}` }
      : { name: t.parent?.full_name ?? "Parent", sub: `parent of ${t.student?.full_name ?? "a student"} · ${t.classes?.name ?? ""}` };
  }
  return { name: (meId === t.student_id ? t.teacher?.full_name : t.student?.full_name) ?? "?", sub: t.classes?.name ?? "" };
}

export function MessagesClient({ threads, classes, me, initialThread, initialClass }: {
  threads: Thread[]; classes: { id: string; name: string; teacher?: string }[]; me: { id: string; role: string }; initialThread?: string; initialClass?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [active, setActive] = useState<string | null>(initialThread ?? threads[0]?.id ?? null);
  const [cls, setCls] = useState(initialClass ?? classes[0]?.id ?? "");
  const [student, setStudent] = useState("");
  const isStudent = me.role === "student";
  const isParent = me.role === "parent";

  const roster = useLoader(async () => {
    if (isStudent || !cls) return [];
    const { data } = await createClient().from("class_members").select("user_id,users(full_name)").eq("class_id", cls).eq("role", "student");
    return (data ?? []) as unknown as { user_id: string; users: { full_name: string } | null }[];
  }, [cls, isStudent]);

  async function start(classId: string, studentId?: string) {
    try {
      const id = await rpc<string>("open_direct_thread", { p_class: classId, p_student: studentId ?? null });
      setActive(id);
      router.refresh();
    } catch (e) { toast(errorText(e), "error"); }
  }

  // Deep link: /messages?class=X from a student's class card opens that thread.
  useEffect(() => {
    if (isStudent && initialClass && !initialThread) void start(initialClass);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const current = threads.find((t) => t.id === active);
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="space-y-4">
        {isParent ? (
          <Card title="New conversation"><p className="text-sm text-ink-600">Open your child's report and choose <strong>Message teacher</strong> on any subject.</p></Card>
        ) : <Card title="New conversation">
          <div className="space-y-2">
            <Field label="Class"><Select value={cls} onChange={(e) => setCls(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}{c.teacher ? ` (${c.teacher})` : ""}</option>)}</Select></Field>
            {!isStudent && <Field label="Student"><Select value={student} onChange={(e) => setStudent(e.target.value)}><option value="">Choose…</option>{(roster.data ?? []).map((r) => <option key={r.user_id} value={r.user_id}>{r.users?.full_name}</option>)}</Select></Field>}
            <Button className="w-full" disabled={!cls || (!isStudent && !student)} onClick={() => start(cls, isStudent ? undefined : student)}>{isStudent ? "Message my teacher" : "Open chat"}</Button>
          </div>
        </Card>}
        <Card title="Conversations" pad={false}>
          {threads.length === 0 ? <p className="p-4 text-sm text-ink-500">No conversations yet.</p> : (
            <ul>{threads.map((t) => {
              const w = withWhom(t, me.id);
              return (
                <li key={t.id}><button onClick={() => setActive(t.id)} aria-current={active === t.id || undefined} className={cn("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-ink-50", active === t.id && "bg-ink-100")}>
                  <Avatar name={w.name} /><span className="min-w-0"><span className="block truncate text-sm font-semibold">{w.name}</span><span className="block truncate text-[12px] text-ink-500">{w.sub}</span></span>
                </button></li>
              );
            })}</ul>
          )}
        </Card>
      </div>
      <Card pad={false} className="overflow-hidden">
        {active ? (
          <>
            {current && <p className="border-b border-ink-100 px-4 py-3 text-sm"><span className="font-semibold">{withWhom(current, me.id).name}</span> <span className="text-ink-500">· {withWhom(current, me.id).sub}</span></p>}
            <ThreadView threadId={active} meId={me.id} canModerate={!isStudent && !isParent} className="h-[65vh]" />
          </>
        ) : <div className="p-6"><Empty title="Pick a conversation" /></div>}
      </Card>
    </div>
  );
}
