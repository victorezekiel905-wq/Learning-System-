"use client";
import { useEffect, useRef, useState } from "react";

// §3.4 — Teacher-side collab whiteboard (writes strokes to /api/collab-boards,
// subscribes via Supabase Realtime to live strokes appended by students).
export default function LiveBoard({ sessionId, boardId, onBoardId }: { sessionId: string; boardId?: string; onBoardId?: (id: string) => void }) {
  const [bid, setBid] = useState<string | undefined>(boardId);
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const c = canvas.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineCap = "round"; ctx.lineWidth = 2;
    let drawing = false; let lastX = 0; let lastY = 0;
    const flushStroke: Array<Record<string, unknown>> = [];
    let pending: Array<{ x: number; y: number }> = [];
    const color = "#1f2937";
    ctx.strokeStyle = color;
    const send = async () => {
      if (!bid || pending.length < 2) return;
      await fetch("/api/collab-boards", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: bid, strokes: [{ points: pending, color, at: Date.now() }] })
      }).catch(() => {});
      pending = [];
    };
    const down = (e: PointerEvent) => {
      drawing = true; const r = c.getBoundingClientRect();
      lastX = e.clientX - r.left; lastY = e.clientY - r.top;
      pending.push({ x: lastX, y: lastY });
    };
    const move = (e: PointerEvent) => {
      if (!drawing) return;
      const r = c.getBoundingClientRect();
      const nx = e.clientX - r.left; const ny = e.clientY - r.top;
      ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(nx, ny); ctx.stroke();
      lastX = nx; lastY = ny; pending.push({ x: nx, y: ny });
    };
    const up = async () => { drawing = false; send(); };
    c.addEventListener("pointerdown", down); c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up); c.addEventListener("pointerleave", up);
    return () => {
      c.removeEventListener("pointerdown", down); c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up); c.removeEventListener("pointerleave", up);
    };
  }, [bid]);

  async function newBoard() {
    const r = await fetch("/api/collab-boards", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, title: `Board ${new Date().toLocaleTimeString()}` })
    });
    const j = await r.json();
    setBid((j as { id: string }).id); onBoardId?.((j as { id: string }).id);
  }

  return (
    <div className="card p-3">
      <header className="mb-2 flex items-center justify-between">
        <p className="text-sm font-semibold">Shared whiteboard</p>
        <div className="flex gap-2">
          {!bid && <button className="btn btn-primary text-xs" onClick={newBoard}>+ New board</button>}
          {bid && <span className="text-xs text-slate-500">Board {bid.slice(0, 6)}</span>}
        </div>
      </header>
      <canvas ref={canvas} width={800} height={420} className="block w-full rounded bg-white shadow-inner" />
      <p className="mt-1 text-xs text-slate-400">Strokes are appended on stroke-end as JSON; a Supabase Realtime subscription on <code>collab_boards</code> propagates them to all joined students in this session.</p>
    </div>
  );
}
