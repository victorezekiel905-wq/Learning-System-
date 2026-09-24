"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useLoader } from "@/lib/hooks";
import { useSignal } from "@/lib/realtime";
import { Alert, Badge, Button, Textarea, useToast } from "@/components/ui";
import { cn } from "@/lib/utils";

type Post = { id: string; body: string; color: string; author_id: string; hidden: boolean; created_at: string; users: { full_name: string } | null };
type Board = { id: string; title: string; locked: boolean; anonymous: boolean; owner_id: string };

const COLORS: Record<string, string> = {
  yellow: "bg-amber-100 border-amber-200", blue: "bg-sky-100 border-sky-200", green: "bg-emerald-100 border-emerald-200",
  pink: "bg-pink-100 border-pink-200", purple: "bg-violet-100 border-violet-200"
};

/**
 * Collaborative board (§3.2). One board per activity per live session; posts
 * appear for everyone in realtime. Teachers can lock the board and hide posts.
 */
export function CollabBoard({ activityId, sessionId, title, tenantId, userId, manage }: {
  activityId: string; sessionId?: string; title: string; tenantId: string; userId: string; manage?: boolean;
}) {
  const toast = useToast();
  const [board, setBoard] = useState<Board | null>(null);
  const [text, setText] = useState("");
  const [color, setColor] = useState("yellow");

  useEffect(() => {
    let live = true;
    (async () => {
      const sb = createClient();
      let q = sb.from("collab_boards").select("id,title,locked,anonymous,owner_id").eq("activity_id", activityId);
      q = sessionId ? q.eq("session_id", sessionId) : q.is("session_id", null);
      const { data } = await q.maybeSingle();
      if (data) { if (live) setBoard(data as Board); return; }
      if (manage) {
        const { data: created, error } = await sb.from("collab_boards")
          .insert({ tenant_id: tenantId, activity_id: activityId, session_id: sessionId ?? null, owner_id: userId, title })
          .select("id,title,locked,anonymous,owner_id").single();
        if (error) toast(error.message, "error"); else if (live) setBoard(created as Board);
      }
    })();
    return () => { live = false; };
  }, [activityId, sessionId, manage, tenantId, userId, title, toast]);

  const posts = useLoader(async () => {
    if (!board) return [] as Post[];
    const { data } = await createClient().from("collab_posts").select("id,body,color,author_id,hidden,created_at,users(full_name)")
      .eq("board_id", board.id).order("created_at");
    return (data ?? []) as unknown as Post[];
  }, [board?.id]);
  useSignal(board ? `board:${board.id}` : null, ["post"], () => void posts.reload(), { minGapMs: 1000 });

  if (!board) return <Alert>{manage ? "Setting up the board…" : "Waiting for your teacher to open the board."}</Alert>;

  async function post() {
    const { error } = await createClient().from("collab_posts").insert({ tenant_id: tenantId, board_id: board!.id, author_id: userId, body: text.trim(), color });
    if (error) toast(error.message, "error"); else { setText(""); void posts.reload(); }
  }
  async function hide(p: Post) {
    await createClient().from("collab_posts").update({ hidden: !p.hidden }).eq("id", p.id);
    void posts.reload();
  }
  async function toggleLock() {
    const { data } = await createClient().from("collab_boards").update({ locked: !board!.locked }).eq("id", board!.id).select("id,title,locked,anonymous,owner_id").single();
    if (data) setBoard(data as Board);
  }

  return (
    <div className="card card-pad space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-bold">{board.title}</h3>
        <div className="flex items-center gap-2">
          {board.locked && <Badge tone="amber">Locked</Badge>}
          {manage && <Button size="sm" variant="secondary" onClick={toggleLock}>{board.locked ? "Unlock" : "Lock board"}</Button>}
        </div>
      </div>
      {!board.locked && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Textarea rows={2} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="Add an idea…" className="flex-1" />
          <div className="flex items-center gap-1 sm:flex-col">
            <div className="flex gap-1">{Object.keys(COLORS).map((c) => (
              <button key={c} type="button" aria-label={c} onClick={() => setColor(c)} className={cn("h-5 w-5 rounded-full border", COLORS[c], color === c && "ring-2 ring-ink-800")} />
            ))}</div>
            <Button onClick={post} disabled={!text.trim()}>Post</Button>
          </div>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(posts.data ?? []).map((p) => (
          <div key={p.id} className={cn("rounded-lg border p-3 text-sm shadow-sm", COLORS[p.color], p.hidden && "opacity-50")}>
            <p className="whitespace-pre-wrap">{p.body}</p>
            <div className="mt-2 flex items-center justify-between text-[11px] text-ink-500">
              <span>{board.anonymous && !manage ? "Classmate" : p.users?.full_name}</span>
              {manage && <button className="font-medium text-ink-700" onClick={() => hide(p)}>{p.hidden ? "Show" : "Hide"}</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
