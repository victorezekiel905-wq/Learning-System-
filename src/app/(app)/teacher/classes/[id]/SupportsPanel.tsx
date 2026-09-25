"use client";
import { useState } from "react";
import { useLoader } from "@/lib/hooks";
import { errorText, rpc } from "@/lib/rpc";
import { Alert, Avatar, Button, Card, Empty, Select, useToast } from "@/components/ui";
import { Icon } from "@/components/Icon";

type Row = { student_id: string; name: string; read_aloud: boolean; readable_font: boolean; extra_time_pct: number; calm_mode: boolean; note: string | null };

const FLAGS: { key: "read_aloud" | "readable_font" | "calm_mode"; label: string; hint: string }[] = [
  { key: "read_aloud", label: "Read aloud", hint: "The Read aloud button is highlighted on every question." },
  { key: "readable_font", label: "Easy-to-read font", hint: "A font designed for low vision and dyslexia, with wider spacing, everywhere the student looks." },
  { key: "calm_mode", label: "Calm mode", hint: "No rankings, and no countdown until the last two minutes of timed work." }
];

/**
 * Learning supports (accommodations), set privately per student. Classmates
 * never see them; the student simply gets the support. The note is staff-only.
 */
export function SupportsPanel({ classId }: { classId: string }) {
  const toast = useToast();
  const rows = useLoader(() => rpc<Row[]>("class_supports", { p_class: classId }), [classId]);
  const [edits, setEdits] = useState<Record<string, Row>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const list = rows.data ?? [];

  async function save(r: Row) {
    setSaving(r.student_id);
    try {
      await rpc("set_student_supports", { p_class: classId, p_student: r.student_id, p_read_aloud: r.read_aloud, p_readable_font: r.readable_font,
        p_extra_time_pct: r.extra_time_pct, p_calm_mode: r.calm_mode, p_note: r.note });
      toast(`Saved supports for ${r.name}`, "success");
      setEdits((e) => { const n = { ...e }; delete n[r.student_id]; return n; });
      void rows.reload();
    } catch (e) { toast(errorText(e), "error"); }
    setSaving(null);
  }

  return (
    <div className="space-y-4">
      <Alert title="Private to staff">
        Supports apply to this student in every class and are never shown to classmates. Use them for students with a learning plan,
        English learners, or anyone who needs a calmer start.
      </Alert>
      <Card title="Learning supports" pad={false}>
        {rows.error && <div className="p-5"><Alert tone="error">{rows.error}</Alert></div>}
        {!rows.loading && list.length === 0 ? <div className="p-5"><Empty title="No students yet" icon={<Icon name="users" />} /></div> : (
          <ul className="divide-y divide-ink-100">
            {list.map((orig) => {
              const r = edits[orig.student_id] ?? orig;
              const dirty = !!edits[orig.student_id];
              const set = (p: Partial<Row>) => setEdits((e) => ({ ...e, [orig.student_id]: { ...r, ...p } }));
              return (
                <li key={r.student_id} className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4 sm:px-6">
                  <div className="flex min-w-[12rem] flex-1 items-center gap-3">
                    <Avatar name={r.name} className="h-9 w-9" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{r.name}</p>
                      <input aria-label={`Staff note for ${r.name}`} className="mt-0.5 w-full bg-transparent text-[13px] text-ink-600 outline-none placeholder:text-ink-400 focus:underline"
                        maxLength={500} placeholder="Staff note (optional)" value={r.note ?? ""} onChange={(e) => set({ note: e.target.value })} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {FLAGS.map((f) => (
                      <label key={f.key} title={f.hint}
                        className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-[13px] font-medium has-[:checked]:border-ink-900 has-[:checked]:bg-ink-900 has-[:checked]:text-white has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-600 has-[:focus-visible]:ring-offset-2">
                        <input type="checkbox" className="sr-only" checked={r[f.key]} onChange={(e) => set({ [f.key]: e.target.checked } as Partial<Row>)} />
                        {f.label}
                      </label>
                    ))}
                    <Select aria-label={`Extra time for ${r.name}`} className="h-9 w-auto text-[13px]" value={r.extra_time_pct}
                      onChange={(e) => set({ extra_time_pct: Number(e.target.value) })}>
                      <option value={0}>No extra time</option><option value={25}>+25% time</option><option value={50}>+50% time</option><option value={100}>Double time</option>
                    </Select>
                    <Button size="sm" disabled={!dirty} loading={saving === r.student_id} onClick={() => save(r)}>Save</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <p className="hint">Extra time applies to timed activities and assignments. For live games, choose "Think it through" (no timer) so nobody is rushed.</p>
    </div>
  );
}
