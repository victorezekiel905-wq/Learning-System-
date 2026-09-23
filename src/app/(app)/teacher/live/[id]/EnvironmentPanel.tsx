"use client";
import Link from "next/link";
import { useState } from "react";
import { Alert, Badge, Button, Card, Select, useToast } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { EvidenceButton } from "@/components/live/ScreenRail";
import { ALERT_LABEL, type SessionState } from "@/components/live/types";
import { errorText, rpc } from "@/lib/rpc";
import { timeAgo } from "@/lib/utils";

const SEVERITY_TONE = { info: "cyan", warning: "amber", critical: "red" } as const;

export function EnvironmentPanel({ state, sessionId, envs, scenes, reload, onView }: {
  state: SessionState; sessionId: string; envs: { id: string; name: string }[]; scenes: { id: string; name: string }[]; reload: () => Promise<void>;
  onView?: (studentId: string) => void;
}) {
  const toast = useToast();
  const s = state.session;
  const [env, setEnv] = useState(s.environment_id ?? envs[0]?.id ?? "");
  const [scene, setScene] = useState(scenes[0]?.id ?? "");

  async function call(fn: string, args: Record<string, unknown>, ok: string) {
    try { await rpc(fn, args); toast(ok, "success"); await reload(); } catch (e) { toast(errorText(e), "error"); }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Environment">
          <p className="mb-3 text-sm">
            {s.environment_active ? <>Active: <strong>{s.environment_name}</strong></> : "No environment active. Devices are monitored but no rules apply."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Select className="max-w-xs" value={env} onChange={(e) => setEnv(e.target.value)}>{envs.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</Select>
            <Button disabled={!env} onClick={() => call("start_environment", { p_session: sessionId, p_policy: env }, "Environment started")}>{s.environment_active ? "Switch" : "Start"}</Button>
            {s.environment_active && <Button variant="secondary" onClick={() => call("stop_environment", { p_session: sessionId }, "Environment stopped")}>Stop</Button>}
          </div>
          {!envs.length && <p className="mt-2 text-sm"><Link href="/guard/environments">Create an environment</Link> to set allowed and blocked sites.</p>}
          <p className="hint mt-3">Students get a grace period before an alert fires, and a lost connection is never counted as leaving.</p>
        </Card>
        <Card title="Scenes">
          {scenes.length ? (
            <div className="flex flex-wrap gap-2">
              <Select className="max-w-xs" value={scene} onChange={(e) => setScene(e.target.value)}>{scenes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
              <Button variant="accent" onClick={() => call("apply_scene", { p_session: sessionId, p_scene: scene }, "Scene applied")}>Apply scene</Button>
            </div>
          ) : <p className="text-sm text-ink-500">Scenes bundle an environment with actions such as opening the lesson tab. <Link href="/guard/environments?tab=scenes">Create one</Link>.</p>}
        </Card>
      </div>

      <Card title="Alerts" pad={false}>
        {state.alerts.length === 0 ? <p className="p-5 text-sm text-ink-500">No alerts in the last 10 minutes.</p> : (
          <ul className="divide-y divide-ink-100">
            {state.alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Badge tone={SEVERITY_TONE[a.severity]}>{ALERT_LABEL[a.kind] ?? a.kind}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{a.student} <span className="font-normal text-ink-500">· {a.rule}</span></p>
                  <p className="text-xs text-ink-500">
                    {timeAgo(a.created_at)}{a.resolved_at && ` · returned ${timeAgo(a.resolved_at)}`}
                    {a.confidence !== null && ` · confidence ${Math.round(Number(a.confidence) * 100)}%`}
                    {a.status !== "open" && ` · ${a.status}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {onView && a.kind !== "connection_lost" && <Button size="sm" variant="secondary" onClick={() => onView(a.student_id)}><Icon name="monitor" className="h-4 w-4" /> View screen</Button>}
                  {a.has_evidence && <EvidenceButton eventId={a.id} student={a.student} />}
                </div>
                {a.status === "open" && (
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" variant="secondary" onClick={() => call("handle_environment_event", { p_event: a.id, p_action: "acknowledge" }, "Acknowledged")}>Acknowledge</Button>
                    {a.kind === "off_task" && <>
                      <Button size="sm" variant="ghost" onClick={() => call("handle_environment_event", { p_event: a.id, p_action: "confirm" }, "Confirmed")}>Confirm</Button>
                      <Button size="sm" variant="ghost" onClick={() => call("handle_environment_event", { p_event: a.id, p_action: "dismiss" }, "Dismissed: similar alerts will be less frequent")}>Dismiss</Button>
                      <Button size="sm" variant="ghost" onClick={() => call("handle_environment_event", { p_event: a.id, p_action: "mute", p_scope: "session" }, "Muted this site for the session")}>Mute site</Button>
                    </>}
                    {a.kind !== "off_task" && <Button size="sm" variant="ghost" onClick={() => call("handle_environment_event", { p_event: a.id, p_action: "dismiss" }, "Dismissed")}>Dismiss</Button>}
                    {a.kind !== "connection_lost" && <Button size="sm" variant="ghost" onClick={() => call("issue_command", { p_session: sessionId, p_students: [a.student_id], p_kind: "message", p_payload: { text: "Your class session requires you to return to the lesson." } }, "Reminder sent")}>Remind</Button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Alert>Off-task alerts are suggestions with a confidence score, not proof. Dismissing them teaches SwiftCipher to flag that site less often.</Alert>

      <Card title="Devices" pad={false}>
        <table className="table">
          <thead><tr><th>Student</th><th>Site</th><th>Tabs</th><th>State</th><th>Last heartbeat</th></tr></thead>
          <tbody>{state.roster.map((r) => (
            <tr key={r.student_id}>
              <td className="font-medium">{r.name}</td>
              <td className="max-w-xs truncate text-xs" title={r.device?.url ?? ""}>{r.device?.domain ?? "—"}</td>
              <td>{r.device?.tab_count ?? "—"}</td>
              <td>{!r.device ? <Badge>no device</Badge> : !r.device.online ? <Badge tone="gray">connection lost</Badge> : r.device.idle_state !== "active" ? <Badge tone="amber">{r.device.idle_state}</Badge> : <Badge tone="green">active</Badge>}</td>
              <td className="text-xs text-ink-500">{r.device ? timeAgo(r.device.last_heartbeat_at) : "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      </Card>
    </div>
  );
}
