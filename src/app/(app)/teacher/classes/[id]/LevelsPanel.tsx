"use client";
import { useState } from "react";
import { Badge, Button, Card, Modal, Field, Input, Select, Toggle, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useLoader, useRpc } from "@/lib/hooks";
import { CHALLENGE } from "@/lib/progress";
import { errorText, rpc } from "@/lib/rpc";
import { pct } from "@/lib/utils";

type Row = {
  student_id: string; name: string; level: 1 | 2 | 3; level_set_by: string;
  answered_30d: number; accuracy_30d: number | null; suggested: 1 | 2 | 3 | null; xp_week: number;
};
type Board = { enabled: boolean; rows: { rank: number; name: string; xp: number }[] };

/** Differentiation + engagement for one class: challenge levels, suggestions, XP, leaderboard. */
export function LevelsPanel({ classId }: { classId: string }) {
  const toast = useToast();
  const rows = useRpc<Row[]>("class_levels", { p_class: classId }, [classId]);
  const flags = useLoader(async () => {
    const { data, error } = await createClient().from("classes").select("leaderboard_enabled,student_choice_enabled").eq("id", classId).single();
    if (error) throw error;
    return data as { leaderboard_enabled: boolean; student_choice_enabled: boolean };
  }, [classId]);
  const board = useRpc<Board>("class_leaderboard", { p_class: classId, p_period: "week" }, [classId]);
  const [award, setAward] = useState<Row | null>(null);

  async function setLevel(studentId: string, level: number) {
    try { await rpc("set_student_level", { p_class: classId, p_student: studentId, p_level: level }); await rows.reload(); }
    catch (e) { toast(errorText(e), "error"); }
  }
  async function applyAll() {
    const todo = (rows.data ?? []).filter((r) => r.suggested && r.suggested !== r.level);
    try {
      for (const r of todo) await rpc("set_student_level", { p_class: classId, p_student: r.student_id, p_level: r.suggested });
      toast(`Updated ${todo.length} student${todo.length === 1 ? "" : "s"}`, "success");
      await rows.reload();
    } catch (e) { toast(errorText(e), "error"); }
  }
  async function setFlag(patch: { p_leaderboard?: boolean; p_student_choice?: boolean }) {
    try { await rpc("set_class_engagement", { p_class: classId, ...patch }); await flags.reload(); await board.reload(); }
    catch (e) { toast(errorText(e), "error"); }
  }

  const pending = (rows.data ?? []).filter((r) => r.suggested && r.suggested !== r.level).length;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2" title="Challenge levels" pad={false}
        actions={pending > 0 && <Button size="sm" variant="secondary" onClick={applyAll}>Apply {pending} suggestion{pending === 1 ? "" : "s"}</Button>}>
        {!rows.data ? <p className="p-5 text-sm text-ink-500">Loading…</p> : rows.data.length === 0 ? <p className="p-5 text-sm text-ink-500">No students yet.</p> : (
          <table className="table">
            <thead><tr><th>Student</th><th>Level</th><th>Accuracy (30 days)</th><th>Suggested</th><th>XP this week</th><th /></tr></thead>
            <tbody>{rows.data.map((r) => (
              <tr key={r.student_id}>
                <td className="font-medium">{r.name}</td>
                <td>
                  <Select aria-label={`Challenge level for ${r.name}`} className="py-1 text-xs" value={r.level} onChange={(e) => setLevel(r.student_id, Number(e.target.value))}>
                    {([1, 2, 3] as const).map((l) => <option key={l} value={l}>{CHALLENGE[l].name}</option>)}
                  </Select>
                  {r.level_set_by === "student" && <span className="ml-1 text-[11px] text-ink-500">chosen by student</span>}
                </td>
                <td className="tabular-nums">{r.answered_30d ? `${pct(r.accuracy_30d)} of ${r.answered_30d}` : "—"}</td>
                <td>{r.suggested ? (r.suggested === r.level ? <Badge tone="green">{CHALLENGE[r.suggested].name}</Badge>
                  : <Button size="sm" variant="ghost" onClick={() => setLevel(r.student_id, r.suggested!)}>Move to {CHALLENGE[r.suggested].name}</Button>)
                  : <span className="text-xs text-ink-500">Needs 5+ answers</span>}</td>
                <td className="tabular-nums">{r.xp_week}</td>
                <td><Button size="sm" variant="ghost" onClick={() => setAward(r)}>Shout-out</Button></td>
              </tr>
            ))}</tbody>
          </table>
        )}
        <p className="border-t border-ink-100 px-5 py-3 text-xs text-ink-500">
          In activities with &ldquo;Differentiate by challenge level&rdquo; on, Support gets difficulty 1–3, Core 2–4 and Extension 3–5 (untagged questions go to everyone).
          Suggestions: 85%+ accuracy → Extension, under 50% → Support.
        </p>
      </Card>

      <div className="space-y-6">
        <Card title="Student voice & motivation">
          {flags.data && (
            <div className="space-y-4">
              <Toggle checked={flags.data.student_choice_enabled} onChange={(v) => setFlag({ p_student_choice: v })}
                label="Students choose their own challenge" description="Students pick Support, Core or Extension on their home page. You can still change it." />
              <Toggle checked={flags.data.leaderboard_enabled} onChange={(v) => setFlag({ p_leaderboard: v })}
                label="Class leaderboard" description="Weekly XP ranking. Classmates see first names and initials only." />
            </div>
          )}
        </Card>
        <Card title="Leaderboard · this week">
          {!board.data || board.data.rows.length === 0 ? <p className="text-sm text-ink-500">No XP earned yet this week.</p> : (
            <ol className="space-y-1 text-sm">{board.data.rows.map((r) => (
              <li key={`${r.rank}-${r.name}`} className="flex justify-between"><span><span className="inline-block w-6 tabular-nums text-ink-500">{r.rank}.</span>{r.name}</span><span className="tabular-nums">{r.xp} XP</span></li>
            ))}</ol>
          )}
        </Card>
      </div>

      <AwardModal student={award} classId={classId} onClose={() => { setAward(null); void rows.reload(); void board.reload(); }} />
    </div>
  );
}

function AwardModal({ student, classId, onClose }: { student: Row | null; classId: string; onClose: () => void }) {
  const toast = useToast();
  const [points, setPoints] = useState(10);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={!!student} onClose={onClose} title={student ? `Shout-out for ${student.name}` : ""}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!reason.trim()} onClick={async () => {
        if (!student) return;
        setBusy(true);
        try { await rpc("award_xp", { p_student: student.student_id, p_points: points, p_reason: reason.trim(), p_class: classId }); toast("Shout-out sent", "success"); setReason(""); onClose(); }
        catch (e) { toast(errorText(e), "error"); }
        setBusy(false);
      }}>Give {points} XP</Button></>}>
      <div className="space-y-3">
        <Field label="What for? (the student sees this)"><Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Great explanation of equivalent fractions" /></Field>
        <Field label="XP (1–50)"><Input type="number" min={1} max={50} value={points} onChange={(e) => setPoints(Math.min(50, Math.max(1, Number(e.target.value) || 1)))} /></Field>
      </div>
    </Modal>
  );
}
