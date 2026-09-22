"use client";
import { useState } from "react";
import { Alert, Badge, Button, Card, Empty, useToast } from "@/components/ui";
import { ALERT_LABEL } from "@/components/live/types";
import { errorText, rpc } from "@/lib/rpc";
import { formatDateTime, timeAgo } from "@/lib/utils";

type Device = { id: string; label: string; os: string | null; browser: string | null; status: string; last_seen_at: string | null; enrolled_at: string };
type BS = { id: string; active_domain: string | null; active_title: string | null; tab_count: number | null; idle_state: string; last_heartbeat_at: string; class_sessions: { title: string } | null };

export function DeviceClient({ devices, sessions, events, notice }: { devices: Device[]; sessions: BS[]; events: { id: string; kind: string; rule: string; created_at: string; status: string }[]; notice: string }) {
  const toast = useToast();
  const [code, setCode] = useState<{ code: string; expires_at: string } | null>(null);

  return (
    <div className="space-y-5">
      <Alert title="What is shared">{notice}</Alert>
      <Card title="Pair this browser">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-700">
          <li>Your school installs the SwiftCipher extension on managed Chrome or Edge browsers.</li>
          <li>Click <strong>Get pairing code</strong>, then enter the code in the extension's popup.</li>
          <li>The code works once and expires in 15 minutes.</li>
        </ol>
        <div className="mt-4 flex items-center gap-4">
          <Button onClick={async () => { try { setCode(await rpc("create_pairing_code", {})); } catch (e) { toast(errorText(e), "error"); } }}>Get pairing code</Button>
          {code && <span className="font-mono text-3xl font-extrabold tracking-[0.25em] text-brand-700">{code.code}</span>}
        </div>
      </Card>

      <Card title="My devices" pad={false}>
        {devices.length === 0 ? <div className="p-5"><Empty title="No paired devices" /></div> : (
          <table className="table"><thead><tr><th>Device</th><th>Status</th><th>Last seen</th></tr></thead>
            <tbody>{devices.map((d) => (
              <tr key={d.id}><td className="font-medium">{d.label}<span className="block text-xs text-ink-500">{[d.os, d.browser].filter(Boolean).join(" · ")}</span></td>
                <td><Badge tone={d.status === "active" ? "green" : "gray"}>{d.status}</Badge></td><td className="text-ink-500">{timeAgo(d.last_seen_at)}</td></tr>
            ))}</tbody></table>
        )}
      </Card>

      <Card title="What my teacher saw recently" pad={false}>
        {sessions.length === 0 ? <p className="p-5 text-sm text-ink-500">Nothing yet. Data is only collected during live class sessions.</p> : (
          <table className="table"><thead><tr><th>Session</th><th>Last site</th><th>Tabs</th><th>Reported</th></tr></thead>
            <tbody>{sessions.map((s) => (
              <tr key={s.id}><td>{s.class_sessions?.title}</td><td className="text-xs">{s.active_domain ?? "—"}<span className="block text-ink-500">{s.active_title}</span></td><td>{s.tab_count ?? "—"}</td><td className="text-ink-500">{formatDateTime(s.last_heartbeat_at)}</td></tr>
            ))}</tbody></table>
        )}
      </Card>

      {events.length > 0 && (
        <Card title="Alerts about me">
          <ul className="space-y-1 text-sm">{events.map((e) => <li key={e.id}><Badge>{ALERT_LABEL[e.kind] ?? e.kind}</Badge> {e.rule} <span className="text-xs text-ink-500">{formatDateTime(e.created_at)}</span></li>)}</ul>
          <p className="hint mt-2">Alerts are only prompts for your teacher to check in. They are never used to make decisions about you automatically.</p>
        </Card>
      )}
    </div>
  );
}
