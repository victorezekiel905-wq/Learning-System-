"use client";
import { useState } from "react";
import { ThreadView } from "@/components/chat/ThreadView";
import { Alert, Avatar, useToast } from "@/components/ui";
import type { SessionState } from "@/components/live/types";
import { errorText, rpc } from "@/lib/rpc";
import { cn } from "@/lib/utils";
import type { Me } from "./LiveRoom";

export function ChatPanel({ state, me }: { state: SessionState; me: Me }) {
  const toast = useToast();
  const [thread, setThread] = useState<{ id: string; label: string } | null>(null);

  async function open(studentId: string | null, label: string) {
    try {
      const id = studentId
        ? await rpc<string>("open_direct_thread", { p_class: state.session.class_id, p_student: studentId })
        : await rpc<string>("open_group_thread", { p_session: state.session.id });
      setThread({ id, label });
    } catch (e) { toast(errorText(e), "error"); }
  }

  return (
    <div className="grid gap-4 md:grid-cols-[240px_1fr]">
      <div className="card p-2">
        {state.session.group_chat_enabled && (
          <button className={cn("mb-1 w-full rounded-lg px-3 py-2 text-left text-sm font-semibold hover:bg-ink-50", thread?.label === "Class chat" && "bg-brand-50")} onClick={() => open(null, "Class chat")}>
            # Class chat
          </button>
        )}
        <p className="px-3 py-1 text-[11px] font-semibold uppercase text-ink-500">Private 1:1</p>
        <ul>
          {state.roster.map((r) => (
            <li key={r.student_id}>
              <button className={cn("flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm hover:bg-ink-50", thread?.label === r.name && "bg-brand-50")} onClick={() => open(r.student_id, r.name)}>
                <Avatar name={r.name} className="h-6 w-6 text-[10px]" />{r.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="card overflow-hidden">
        {thread ? (
          <>
            <p className="border-b border-ink-100 px-4 py-2 text-sm font-semibold">{thread.label}</p>
            <ThreadView threadId={thread.id} meId={me.id} canModerate className="h-[460px]" />
          </>
        ) : <div className="p-5"><Alert>Pick a student to start a private conversation. Messages are only visible to you and them{state.session.group_chat_enabled ? ", or open the class chat." : "."}</Alert></div>}
      </div>
    </div>
  );
}
