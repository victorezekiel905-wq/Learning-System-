"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Alert, Button, Card, Select, useDialog, useToast } from "@/components/ui";
import { errorText, rpc } from "@/lib/rpc";
import { nextName } from "@/app/(app)/teacher/classes/[id]/Promote";

export type PromoteClass = { id: string; name: string; students: number };
const STAY = "", LEAVE = "leave";

export function PromoteSchool({ classes }: { classes: PromoteClass[] }) {
  const router = useRouter();
  const toast = useToast();
  const dialog = useDialog();
  // Suggest the class whose name is this one's with the number one higher (JSS 1 Gold -> JSS 2 Gold).
  const initial = useMemo(() => Object.fromEntries(classes.map((c) => {
    const next = classes.find((x) => x.id !== c.id && x.name.toLowerCase() === nextName(c.name).toLowerCase());
    return [c.id, next ? next.id : STAY];
  })), [classes]);
  const [plan, setPlan] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);

  const moving = classes.filter((c) => plan[c.id] && plan[c.id] !== LEAVE);
  const leaving = classes.filter((c) => plan[c.id] === LEAVE);
  const movedCount = moving.reduce((n, c) => n + c.students, 0);
  const leftCount = leaving.reduce((n, c) => n + c.students, 0);

  async function run() {
    const ok = await dialog.confirm({ title: "Promote the school now?", confirmLabel: "Promote",
      body: `${movedCount} students move to their next class${leftCount ? ` and ${leftCount} leave their class (finished school)` : ""}. Results and reports stay with each student.` });
    if (!ok) return;
    setBusy(true);
    try {
      const moves = classes.filter((c) => plan[c.id]).map((c) => ({ from: c.id, to: plan[c.id] === LEAVE ? null : plan[c.id] }));
      const r = await rpc<{ moved: number; left: number }>("promote_school", { p_moves: moves });
      toast(`${r.moved} students promoted${r.left ? `, ${r.left} finished` : ""}`, "success");
      router.refresh();
      setPlan(Object.fromEntries(classes.map((c) => [c.id, STAY])));
    } catch (e) { toast(errorText(e), "error"); }
    setBusy(false);
  }

  if (!classes.length) return <Alert>There are no classes yet.</Alert>;
  return (
    <div className="space-y-5">
      <Card pad={false}>
        <ul className="divide-y divide-ink-100">
          {classes.map((c) => (
            <li key={c.id} className="grid items-center gap-3 px-5 py-3.5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1.1fr)] sm:px-6">
              <div className="min-w-0">
                <p className="truncate font-semibold text-ink-900">{c.name}</p>
                <p className="text-[13px] text-ink-500">{c.students} student{c.students === 1 ? "" : "s"}</p>
              </div>
              <ArrowRight className="hidden h-4 w-4 text-ink-400 sm:block" aria-hidden />
              <Select aria-label={`Next class for ${c.name}`} value={plan[c.id] ?? STAY} onChange={(e) => setPlan((p) => ({ ...p, [c.id]: e.target.value }))}>
                <option value={STAY}>Stays where it is</option>
                {classes.filter((x) => x.id !== c.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                <option value={LEAVE}>Finished school (leave the class)</option>
              </Select>
            </li>
          ))}
        </ul>
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-600">{movedCount} students move{leftCount ? `, ${leftCount} finish` : ""}. Missing a class for next year? Create it on the Classes page first.</p>
        <Button loading={busy} disabled={!moving.length && !leaving.length} onClick={run}>Promote</Button>
      </div>
    </div>
  );
}
