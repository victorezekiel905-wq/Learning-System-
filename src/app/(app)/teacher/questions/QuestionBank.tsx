"use client";
import { useState } from "react";
import { blankQuestion, KIND_LABEL, QuestionEditor, saveQuestion, type EditableQuestion } from "@/components/activities/QuestionEditor";
import { Badge, Button, Card, Empty, Input, Modal, Select, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useLoader } from "@/lib/hooks";
import { errorText } from "@/lib/rpc";
import type { QuestionKind } from "@/lib/types";

type Row = EditableQuestion & { owner_id: string; activity_id: string | null };

export function QuestionBank({ me }: { me: { id: string; tenantId: string } }) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [tag, setTag] = useState("");
  const [editing, setEditing] = useState<EditableQuestion | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useLoader(async () => {
    let q = createClient().from("questions")
      .select("id,kind,prompt,points,explanation,config,answer_key,tags,difficulty,bloom_level,in_bank,position,owner_id,activity_id,question_options(id,label,is_correct,feedback,position)")
      .or(`in_bank.eq.true,and(owner_id.eq.${me.id},activity_id.is.null)`).order("created_at", { ascending: false }).limit(200);
    if (search.trim()) q = q.ilike("prompt", `%${search.trim().replace(/[%_]/g, "")}%`);
    if (kind) q = q.eq("kind", kind);
    if (tag.trim()) q = q.contains("tags", [tag.trim().toLowerCase()]);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r) => ({
      ...(r as unknown as Row),
      options: ((r.question_options ?? []) as { id: string; label: string; is_correct: boolean; feedback: string | null; position: number }[]).sort((a, b) => a.position - b.position)
    })) as Row[];
  }, [search, kind, tag]);

  async function save() {
    if (!editing) return;
    setBusy(true);
    try { await saveQuestion({ ...editing, in_bank: true }, { tenantId: me.tenantId, ownerId: me.id, activityId: (editing as Row).activity_id ?? null }); setEditing(null); void rows.reload(); toast("Saved to the bank", "success"); }
    catch (e) { toast(errorText(e), "error"); }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select aria-label="Filter by question type" value={kind} onChange={(e) => setKind(e.target.value)} className="w-52"><option value="">All types</option>{(Object.keys(KIND_LABEL) as QuestionKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</Select>
        <Input placeholder="Tag" value={tag} onChange={(e) => setTag(e.target.value)} className="w-36" />
        <Select aria-label="Add a question" className="ml-auto w-auto" value="" onChange={(e) => e.target.value && setEditing({ ...blankQuestion(e.target.value as QuestionKind), in_bank: true })}>
          <option value="">+ New question…</option>{(Object.keys(KIND_LABEL) as QuestionKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </Select>
      </div>
      {(rows.data ?? []).length === 0 ? <Empty title="The bank is empty">Tick "Share in the school question bank" on any question, or create one here.</Empty> : (
        <Card pad={false}>
          <ul className="divide-y divide-ink-100">{(rows.data ?? []).map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0"><p className="text-sm">{r.prompt}</p>
                <p className="mt-1 flex flex-wrap gap-1"><Badge tone="brand">{KIND_LABEL[r.kind]}</Badge>{r.difficulty && <Badge>difficulty {r.difficulty}</Badge>}{r.tags.map((t) => <Badge key={t} tone="cyan">#{t}</Badge>)}</p></div>
              {r.owner_id === me.id && <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Button>}
            </li>
          ))}</ul>
        </Card>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} wide title="Bank question">
        {editing && <QuestionEditor value={editing} onChange={setEditing} onSave={save} saving={busy} />}
      </Modal>
    </div>
  );
}
