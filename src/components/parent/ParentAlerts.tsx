"use client";
import { useEffect, useState } from "react";
import { Button, Card, Field, Select, Toggle, useToast } from "@/components/ui";
import { useRpc } from "@/lib/hooks";
import { rpc } from "@/lib/rpc";

type Prefs = { alert_on_leave: boolean; weekly_digest: boolean; low_score_below: number | null };

/** Each guardian chooses their own alerts for each child (nothing is on by default except the weekly summary). */
export function ParentAlerts({ studentId, name }: { studentId: string; name: string }) {
  const toast = useToast();
  const saved = useRpc<Prefs>("parent_alerts", { p_student: studentId }, [studentId]);
  const [p, setP] = useState<Prefs | null>(null);
  useEffect(() => { if (saved.data) setP(saved.data); }, [saved.data]);
  if (!p) return null;
  const dirty = JSON.stringify(p) !== JSON.stringify(saved.data);
  const first = name.split(" ")[0];

  return (
    <Card title="Alerts">
      <div className="space-y-4">
        <Toggle checked={p.alert_on_leave} onChange={(v) => setP({ ...p, alert_on_leave: v })}
          label={`Tell me when ${first} leaves a lesson`} description="A notification the moment it happens, with what they were doing and where they went." />
        <Toggle checked={p.weekly_digest} onChange={(v) => setP({ ...p, weekly_digest: v })}
          label="Weekly summary" description="Every Friday afternoon: the week's report, subject by subject." />
        <Field label="Tell me about a grade below">
          <Select value={p.low_score_below ?? ""} onChange={(e) => setP({ ...p, low_score_below: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Don't alert me about grades</option>
            {[40, 50, 60, 70, 80].map((n) => <option key={n} value={n}>{n}%</option>)}
          </Select>
        </Field>
        <Button disabled={!dirty} onClick={async () => {
          await rpc("set_parent_alerts", { p_student: studentId, p_alert_on_leave: p.alert_on_leave, p_weekly_digest: p.weekly_digest, p_low_score_below: p.low_score_below });
          await saved.reload();
          toast("Alert settings saved", "success");
        }}>Save alerts</Button>
      </div>
    </Card>
  );
}
