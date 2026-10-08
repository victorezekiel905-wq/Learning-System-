import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** public.my_classes (0970): the student's classes, each with their own results this term. */
export type MyClass = {
  id: string; name: string; subject: string | null; teacher: string | null; period: string;
  held: number; attended: number; answers: number; accuracy: number | null;
  strongest: { topic: string; accuracy: number } | null; weakest: { topic: string; accuracy: number } | null;
};

export function MyClasses({ classes }: { classes: MyClass[] }) {
  return (
    <section aria-labelledby="my-classes" className="mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 id="my-classes" className="section-title">Your classes</h2>
        <Link href="/student/progress" className="inline-flex items-center gap-1 text-[13px] font-semibold no-underline">All your progress <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {classes.map((c) => (
          <article key={c.id} className="card flex flex-col p-5">
            <div className="min-w-0">
              <h3 className="truncate font-display text-[16px] font-semibold text-ink-900">{c.name}</h3>
              <p className="truncate text-[13px] text-ink-500">{[c.subject, c.teacher].filter(Boolean).join(" · ") || " "}</p>
            </div>
            {c.accuracy === null ? (
              <p className="mt-5 flex-1 text-sm text-ink-500">No answers yet this term. Your results appear here after your first live lesson.</p>
            ) : (
              <div className="mt-5 flex-1">
                <p className="flex items-baseline gap-2">
                  <span className="font-display text-[30px] font-bold leading-none tracking-[-0.02em] text-ink-900">{c.accuracy}%</span>
                  <span className="text-[13px] text-ink-500">right this term</span>
                </p>
                <span className="mt-3 block h-1.5 overflow-hidden rounded-full bg-ink-100" aria-hidden>
                  <span className={cn("block h-full rounded-full", c.accuracy < 50 ? "bg-rose-500" : "bg-ink-800")} style={{ width: `${c.accuracy}%` }} />
                </span>
                <dl className="mt-4 space-y-1.5 text-[13px]">
                  {c.held > 0 && <div className="flex justify-between gap-3"><dt className="text-ink-500">Lessons</dt><dd className="text-ink-800">{c.attended} of {c.held}</dd></div>}
                  {c.strongest && <div className="flex justify-between gap-3"><dt className="text-ink-500">Strongest</dt><dd className="truncate text-ink-800">{c.strongest.topic} · {c.strongest.accuracy}%</dd></div>}
                  {c.weakest && <div className="flex justify-between gap-3"><dt className="text-ink-500">Practise</dt><dd className="truncate font-medium text-rose-700">{c.weakest.topic} · {c.weakest.accuracy}%</dd></div>}
                </dl>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
