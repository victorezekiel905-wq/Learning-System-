"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ThreadView } from "@/components/chat/ThreadView";
import { Avatar, Button, Card, Empty, Field, Select, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useLoader } from "@/lib/hooks";
import { errorText, rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";

type Thread = { id: string; class_id: string; student_id: string; teacher_id: string; classes: { name: string } | null; student: { full_name: string } | null; teacher: { full_name: string } | null };

export function MessagesClient({ threads, classes, me, initialThread, initialClass }: {
  threads: Thread[]; classes: { id: string; name: string; teacher?: string }[]; me: { id: string; role: string }; initialThread?: string; initialClass?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [active, setActive] = useState<string | null>(initialThread ?? threads[0]?.id ?? null);
  const [cls, setCls] = useState(initialClass ?? classes[0]?.id ?? "");
  const [student, setStudent] = useState("");
  const isStudent = me.role === "student";

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
        <Card title="New conversation">
          <div className="space-y-2">
            <Field label="Class"><Select value={cls} onChange={(e) => setCls(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}{c.teacher ? ` (${c.teacher})` : ""}</option>)}</Select></Field>
            {!isStudent && <Field label="Student"><Select value={student} onChange={(e) => setStudent(e.target.value)}><option value="">Choose…</option>{(roster.data ?? []).map((r) => <option key={r.user_id} value={r.user_id}>{r.users?.full_name}</option>)}</Select></Field>}
            <Button className="w-full" disabled={!cls || (!isStudent && !student)} onClick={() => start(cls, isStudent ? undefined : student)}>{isStudent ? "Message my teacher" : "Open chat"}</Button>
          </div>
        </Card>
        <Card title="Conversations" pad={false}>
          {threads.length === 0 ? <p className="p-4 text-sm text-ink-500">No conversations yet.</p> : (
            <ul>{threads.map((t) => {
              const other = me.id === t.student_id ? t.teacher?.full_name : t.student?.full_name;
              return (
                <li key={t.id}><button onClick={() => setActive(t.id)} className={cn("flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-ink-50", active === t.id && "bg-brand-50")}>
                  <Avatar name={other ?? "?"} /><span className="min-w-0"><span className="block truncate text-sm font-medium">{other}</span><span className="block truncate text-xs text-ink-500">{t.classes?.name}</span></span>
                </button></li>
              );
            })}</ul>
          )}
        </Card>
      </div>
      <Card pad={false} className="overflow-hidden">
        {active ? (
          <>
            {current && <p className="border-b border-ink-100 px-4 py-2 text-sm font-semibold">{me.id === current.student_id ? current.teacher?.full_name : current.student?.full_name} · {current.classes?.name}</p>}
            <ThreadView threadId={active} meId={me.id} canModerate={!isStudent} className="h-[65vh]" />
          </>
        ) : <div className="p-6"><Empty title="Pick a conversation" /></div>}
      </Card>
    </div>
  );
}
