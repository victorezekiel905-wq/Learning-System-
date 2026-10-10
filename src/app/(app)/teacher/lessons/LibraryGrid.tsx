"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, Empty, useToast } from "@/components/ui";
import { errorText, rpc } from "@/lib/rpc";

export type LibraryItem = { id: string; title: string; subject: string; level: string; description: string | null; slides: number; questions: number; uses: number };

/** The SwiftCipher library (migration 1060): ready-made lessons a teacher copies into their school and changes. */
export function LibraryGrid({ items }: { items: LibraryItem[] }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  if (!items.length) return <Empty title="Nothing matches">Try another subject, class or search.</Empty>;
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((it) => (
        <div key={it.id} className="card card-pad flex flex-col">
          <div className="flex flex-wrap items-center gap-1.5"><Badge tone="brand">{it.subject}</Badge><Badge>{it.level}</Badge></div>
          <h2 className="mt-2 font-semibold text-ink-900">{it.title}</h2>
          {it.description && <p className="mt-1 flex-1 text-sm text-ink-600">{it.description}</p>}
          <p className="mt-3 text-xs text-ink-500">{it.slides} slides · {it.questions} questions{it.uses ? ` · used ${it.uses} time${it.uses === 1 ? "" : "s"}` : ""}</p>
          <Button className="mt-3 self-start" size="sm" loading={busy === it.id} onClick={async () => {
            setBusy(it.id);
            try { const id = await rpc<string>("library_copy", { p_item: it.id }); router.push(`/teacher/lessons/${id}`); }
            catch (e) { toast(errorText(e), "error"); setBusy(null); }
          }}>Use this lesson</Button>
        </div>
      ))}
    </div>
  );
}
