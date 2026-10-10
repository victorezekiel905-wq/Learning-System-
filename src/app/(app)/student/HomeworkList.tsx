import Link from "next/link";
import { cn, formatDateTime } from "@/lib/utils";

export type StudentHomework = { id: string; title: string; class: string; due_at: string; open: boolean; questions: number; answered: number; started: boolean };

/** The student's homework (migration 1080): due dates, how far they have got, and a way in. */
export function HomeworkList({ items, now }: { items: StudentHomework[]; now: number }) {
  if (!items.length) return null;
  return (
    <section className="mb-8" aria-labelledby="homework">
      <h2 id="homework" className="section-title mb-3">Homework</h2>
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((w) => {
          const done = w.questions > 0 && w.answered >= w.questions;
          const soon = w.open && !done && new Date(w.due_at).getTime() - now < 86_400_000;
          return (
            <li key={w.id} className="card card-pad flex flex-col">
              <p className="text-xs text-ink-500">{w.class}</p>
              <p className="font-semibold text-ink-900">{w.title}</p>
              <p className={cn("mt-1 text-sm", soon ? "font-semibold text-tile-heart" : "text-ink-600")}>{w.open ? `Due ${formatDateTime(w.due_at)}` : "Closed"}</p>
              {w.questions > 0 && (
                <div className="mt-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-ink-100" aria-hidden>
                    <div className="h-full rounded-full bg-tile-moon" style={{ width: `${Math.min(100, (w.answered / w.questions) * 100)}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-ink-500">{w.answered} of {w.questions} questions answered</p>
                </div>
              )}
              {w.open && (
                <Link href={`/student/live/${w.id}`} className={cn("btn btn-sm mt-3 self-start no-underline", done ? "btn-secondary" : "btn-primary")}>
                  {done ? "Look again" : w.started ? "Carry on" : "Start"}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
