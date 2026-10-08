"use client";
import { useMemo, useState } from "react";
import { Alert, Button, Field, Input, Modal, Select, useToast } from "@/components/ui";
import { useRpc } from "@/lib/hooks";
import { errorText, rpc } from "@/lib/rpc";

type Target = { id: string; name: string; subject: string | null; teacher: string | null; students: number };

/** Move this class's students (all, or some) to the next class, e.g. JSS 1 Gold to JSS 2 Gold. */
export function Promote({ cls, students, onClose }: {
  cls: { id: string; name: string; subject: string | null };
  students: { user_id: string; name: string }[];
  onClose: (changed: boolean) => void;
}) {
  const toast = useToast();
  const targets = useRpc<Target[]>("promotion_targets", { p_class: cls.id }, [cls.id]);
  const suggested = useMemo(() => nextName(cls.name), [cls.name]);
  const [to, setTo] = useState<string>("");
  const [newName, setNewName] = useState(suggested);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(students.map((s) => s.user_id)));
  const [busy, setBusy] = useState(false);
  const list = targets.data ?? [];
  const match = list.find((t) => t.name.toLowerCase() === suggested.toLowerCase());
  const chosen = to || (match ? match.id : "new");

  async function run() {
    setBusy(true);
    try {
      let target = chosen;
      if (target === "new") {
        if (!newName.trim()) throw new Error("Name the new class.");
        const made = await rpc<{ id: string }>("create_class", { p_name: newName.trim(), p_subject: cls.subject });
        target = made.id;
      }
      const all = picked.size === students.length;
      const n = await rpc<number>("promote_students", { p_from: cls.id, p_to: target, p_students: all ? null : [...picked] });
      toast(`${n} student${n === 1 ? "" : "s"} moved`, "success");
      onClose(true);
    } catch (e) { toast(errorText(e), "error"); setBusy(false); }
  }

  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Modal open onClose={() => onClose(false)} wide title={`Promote ${cls.name}`}
      footer={<><Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button>
        <Button loading={busy} disabled={!picked.size} onClick={run}>Move {picked.size} student{picked.size === 1 ? "" : "s"}</Button></>}>
      <div className="space-y-5">
        <p className="text-sm text-ink-600">The students leave {cls.name} and join the next class. Their results and reports stay with them.</p>
        <Field label="Next class" htmlFor="promote-to">
          <Select id="promote-to" value={chosen} onChange={(e) => setTo(e.target.value)}>
            {list.map((t) => <option key={t.id} value={t.id}>{t.name}{t.teacher ? ` · ${t.teacher}` : ""} ({t.students} students)</option>)}
            <option value="new">A new class…</option>
          </Select>
        </Field>
        {chosen === "new" && (
          <Field label="Name of the new class" hint="You can rename it and change its teacher later." htmlFor="promote-new">
            <Input id="promote-new" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </Field>
        )}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="label !mb-0">Students to move</p>
            <button type="button" className="text-[13px] font-semibold text-brand-700"
              onClick={() => setPicked(picked.size === students.length ? new Set() : new Set(students.map((s) => s.user_id)))}>
              {picked.size === students.length ? "Untick all" : "Tick all"}
            </button>
          </div>
          {students.length === 0 ? <Alert>There are no students in this class.</Alert> : (
            <ul className="grid max-h-64 gap-1 overflow-y-auto rounded-xl border border-ink-200 p-2 sm:grid-cols-2">
              {students.map((s) => (
                <li key={s.user_id}>
                  <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-ink-50">
                    <input type="checkbox" className="h-4 w-4 accent-ink-900" checked={picked.has(s.user_id)} onChange={() => toggle(s.user_id)} />{s.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">Untick anyone who is repeating the class; they stay in {cls.name}.</p>
        </div>
      </div>
    </Modal>
  );
}

/** "JSS 1 Gold" -> "JSS 2 Gold", "Primary 4" -> "Primary 5": the first number goes up by one. */
export function nextName(name: string): string {
  const m = /\d+/.exec(name);
  return m ? name.slice(0, m.index) + String(Number(m[0]) + 1) + name.slice(m.index + m[0].length) : `${name} (next year)`;
}
