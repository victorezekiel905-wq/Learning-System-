"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Card, Empty, Field, Input, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { uid } from "@/lib/utils";

type Level = { label: string; points: number; description?: string };
type Criterion = { id: string; title: string; levels: Level[] };
type Rubric = { id?: string; title: string; criteria: Criterion[]; owner_id?: string };

const DEFAULT_LEVELS: Level[] = [{ label: "Exceeds", points: 4 }, { label: "Meets", points: 3 }, { label: "Approaching", points: 2 }, { label: "Beginning", points: 1 }];

export function RubricsClient({ rubrics, me }: { rubrics: Rubric[]; me: { id: string; tenantId: string } }) {
  const router = useRouter();
  const toast = useToast();
  const [edit, setEdit] = useState<Rubric | null>(null);

  async function save(r: Rubric) {
    const sb = createClient();
    const { error } = r.id ? await sb.from("rubrics").update({ title: r.title, criteria: r.criteria }).eq("id", r.id)
      : await sb.from("rubrics").insert({ tenant_id: me.tenantId, owner_id: me.id, title: r.title, criteria: r.criteria });
    if (error) toast(error.message, "error"); else { setEdit(null); router.refresh(); }
  }

  if (edit) {
    return (
      <Card title={edit.id ? "Edit rubric" : "New rubric"}>
        <div className="space-y-4">
          <Field label="Title"><Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field>
          {edit.criteria.map((c, i) => (
            <div key={c.id} className="rounded-lg border border-ink-200 p-3">
              <div className="flex gap-2"><Input value={c.title} placeholder="Criterion, e.g. Accuracy" onChange={(e) => setEdit({ ...edit, criteria: edit.criteria.map((x, j) => j === i ? { ...x, title: e.target.value } : x) })} />
                <Button variant="ghost" onClick={() => setEdit({ ...edit, criteria: edit.criteria.filter((_, j) => j !== i) })}>✕</Button></div>
              <div className="mt-2 grid gap-2 sm:grid-cols-4">{c.levels.map((l, k) => (
                <div key={k} className="space-y-1">
                  <Input value={l.label} onChange={(e) => setEdit({ ...edit, criteria: edit.criteria.map((x, j) => j === i ? { ...x, levels: x.levels.map((y, m) => m === k ? { ...y, label: e.target.value } : y) } : x) })} />
                  <Input type="number" value={l.points} onChange={(e) => setEdit({ ...edit, criteria: edit.criteria.map((x, j) => j === i ? { ...x, levels: x.levels.map((y, m) => m === k ? { ...y, points: Number(e.target.value) } : y) } : x) })} />
                </div>
              ))}</div>
            </div>
          ))}
          <div className="flex justify-between">
            <Button variant="secondary" onClick={() => setEdit({ ...edit, criteria: [...edit.criteria, { id: uid(), title: "", levels: DEFAULT_LEVELS.map((l) => ({ ...l })) }] })}>Add criterion</Button>
            <div className="flex gap-2"><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button disabled={!edit.title.trim() || !edit.criteria.length} onClick={() => save(edit)}>Save rubric</Button></div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Button onClick={() => setEdit({ title: "", criteria: [{ id: uid(), title: "", levels: DEFAULT_LEVELS.map((l) => ({ ...l })) }] })}>New rubric</Button>
      {rubrics.length === 0 ? <Empty title="No rubrics yet" /> : rubrics.map((r) => (
        <Card key={r.id} title={r.title} actions={r.owner_id === me.id && <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Edit</Button>}>
          <ul className="text-sm">{r.criteria.map((c) => <li key={c.id}>• {c.title}: {c.levels.map((l) => `${l.label} ${l.points}`).join(" / ")}</li>)}</ul>
        </Card>
      ))}
    </div>
  );
}
