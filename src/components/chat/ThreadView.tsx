"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Textarea, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useLoader } from "@/lib/hooks";
import { useSignal } from "@/lib/realtime";
import { errorText, rpc } from "@/lib/rpc";
import { cn, timeAgo } from "@/lib/utils";

type Msg = { id: string; body: string; sender_id: string; hidden: boolean; created_at: string; users: { full_name: string } | null };

export function ThreadView({ threadId, meId, canModerate, className }: { threadId: string; meId: string; canModerate?: boolean; className?: string }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const msgs = useLoader(async () => {
    const { data } = await createClient().from("chat_messages").select("id,body,sender_id,hidden,created_at,users(full_name)")
      .eq("thread_id", threadId).order("created_at").limit(300);
    return (data ?? []) as unknown as Msg[];
  }, [threadId]);
  useSignal(`thread:${threadId}`, ["message"], () => void msgs.reload(), { debounceMs: 100 });
  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [msgs.data?.length]);

  async function send() {
    setBusy(true);
    try { await rpc("send_message", { p_thread: threadId, p_body: text }); setText(""); void msgs.reload(); }
    catch (e) { toast(errorText(e), "error"); }
    setBusy(false);
  }

  return (
    <div className={cn("flex h-full min-h-[320px] flex-col", className)}>
      <div className="flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite">
        {(msgs.data ?? []).length === 0 && <p className="text-center text-sm text-ink-500">No messages yet.</p>}
        {(msgs.data ?? []).map((m) => {
          const mine = m.sender_id === meId;
          return (
            <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm", mine ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-900", m.hidden && "opacity-50")}>
                {!mine && <p className="text-[11px] font-semibold opacity-70">{m.users?.full_name}</p>}
                <p className="whitespace-pre-wrap">{m.hidden && !canModerate && !mine ? "Message hidden by teacher" : m.body}</p>
                <p className={cn("mt-0.5 text-[10px]", mine ? "text-white/70" : "text-ink-500")}>
                  {timeAgo(m.created_at)}
                  {canModerate && !mine && !m.hidden && <button className="ml-2 underline" onClick={async () => { try { await rpc("hide_message", { p_message: m.id }); void msgs.reload(); } catch (e) { toast(errorText(e), "error"); } }}>hide</button>}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>
      <form className="flex gap-2 border-t border-ink-100 p-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void send(); }}>
        <Textarea rows={1} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="Write a message…" className="min-h-0"
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (text.trim()) void send(); } }} />
        <Button type="submit" loading={busy} disabled={!text.trim()}>Send</Button>
      </form>
    </div>
  );
}
