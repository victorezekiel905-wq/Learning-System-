"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { rpc } from "@/lib/rpc";

export type OpenLesson = { id: string; title: string; guest: boolean; name: string; homework: boolean };

/**
 * After a restart, a flat battery or a lost connection: the live lessons this browser
 * is still in (migration 1110), one tap to get back. Nothing shows when there are none.
 */
export function RejoinLessons({ className, exclude = [] }: { className?: string; /** Lessons already shown elsewhere on the page. */ exclude?: string[] }) {
  const [open, setOpen] = useState<OpenLesson[]>([]);
  useEffect(() => {
    let live = true;
    void (async () => {
      const { data: { session } } = await createClient().auth.getSession();
      if (!session) return;
      try {
        const rows = await rpc<OpenLesson[]>("my_open_lessons");
        if (live) setOpen(rows.filter((r) => !r.homework).slice(0, 3));
      } catch { /* nothing to offer */ }
    })();
    return () => { live = false; };
  }, []);
  const shown = open.filter((l) => !exclude.includes(l.id));
  if (!shown.length) return null;
  return (
    <div className={className}>
      {shown.map((l) => (
        <Link key={l.id} href={l.guest ? `/guest/live/${l.id}` : `/student/live/${l.id}`}
          className="mb-3 flex items-center justify-between gap-3 rounded-2xl bg-accent-500 px-5 py-4 text-accent-ink no-underline hover:bg-accent-400 hover:text-accent-ink">
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold">You&apos;re still in this lesson</span>
            <span className="block truncate font-display text-lg font-extrabold">{l.title}</span>
            <span className="block text-[13px]">as {l.name}</span>
          </span>
          <span className="btn btn-primary shrink-0">Rejoin</span>
        </Link>
      ))}
    </div>
  );
}
