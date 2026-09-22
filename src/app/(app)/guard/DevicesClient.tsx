"use client";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Alert, Badge, Button, Card, CopyButton, Empty, Field, Input, Modal, Select, useToast } from "@/components/ui";
import { errorText, rpc } from "@/lib/rpc";
import { formatDateTime, timeAgo } from "@/lib/utils";

type Device = { id: string; label: string; os: string | null; browser: string | null; agent_version: string | null; status: string; last_seen_at: string | null; enrolled_at: string; student_id: string | null; users: { full_name: string } | null };
type Diag = {
  device: { label: string; os: string; browser: string; agent_version: string; status: string; last_seen_at: string | null };
  online: boolean; seconds_since_seen: number | null; student_in_live_session: boolean;
  recent_commands: { kind: string; status: string; error: string | null; created_at: string }[];
  enrollments: { student: string | null; method: string; created_at: string; revoked_at: string | null }[];
};

export function DevicesClient({ devices, students, isIt, appUrl }: { devices: Device[]; students: { id: string; full_name: string; email: string }[]; isIt: boolean; appUrl: string }) {
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [diag, setDiag] = useState<Diag | null>(null);
  const [pairFor, setPairFor] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const online = (d: Device) => d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 45_000;

  const rows = useMemo(() => devices.filter((d) =>
    (filter === "all" || (filter === "online" ? online(d) : d.status === filter)) &&
    (!search || `${d.label} ${d.users?.full_name ?? ""}`.toLowerCase().includes(search.toLowerCase()))), [devices, filter, search]);

  async function act(fn: string, args: Record<string, unknown>, msg: string) {
    try { await rpc(fn, args); toast(msg, "success"); router.refresh(); } catch (e) { toast(errorText(e), "error"); }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Enrol a device">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-700">
            <li>Install the SwiftCipher extension on the managed Chrome/Edge profile (force-install through your admin console, or load the <code>extension/</code> folder unpacked for testing).</li>
            <li>Set the server address in the extension to <code>{appUrl || "your SwiftCipher URL"}</code>. Managed installs can push this with the <code>serverUrl</code> policy.</li>
            <li>Create a pairing code for the student and type it into the extension. Students can also create their own code under <strong>This device</strong>.</li>
          </ol>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <Field label="Student" className="min-w-[16rem]"><Select value={pairFor} onChange={(e) => { setPairFor(e.target.value); setCode(null); }}>
              <option value="">Choose a student…</option>{students.map((s) => <option key={s.id} value={s.id}>{s.full_name} · {s.email}</option>)}
            </Select></Field>
            <Button disabled={!pairFor} onClick={async () => { try { setCode((await rpc<{ code: string }>("create_pairing_code", { p_student: pairFor })).code); } catch (e) { toast(errorText(e), "error"); } }}>Create pairing code</Button>
            {code && <><span className="font-mono text-2xl font-extrabold tracking-[0.2em] text-brand-700">{code}</span><CopyButton value={code} /></>}
          </div>
        </Card>
        <Card title="Fleet">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-ink-500">Enrolled</dt><dd className="text-2xl font-bold">{devices.filter((d) => d.status === "active").length}</dd></div>
            <div><dt className="text-ink-500">Online now</dt><dd className="text-2xl font-bold text-emerald-600">{devices.filter(online).length}</dd></div>
            <div><dt className="text-ink-500">Disabled</dt><dd className="text-2xl font-bold">{devices.filter((d) => d.status === "disabled").length}</dd></div>
            <div><dt className="text-ink-500">Unassigned</dt><dd className="text-2xl font-bold">{devices.filter((d) => !d.student_id).length}</dd></div>
          </dl>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input placeholder="Search device or student" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-40">
          <option value="all">All</option><option value="online">Online</option><option value="active">Enrolled</option><option value="disabled">Disabled</option><option value="unenrolled">Unenrolled</option>
        </Select>
      </div>

      {rows.length === 0 ? <Empty title="No devices">Enrolled browsers appear here.</Empty> : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead><tr><th>Device</th><th>Student</th><th>Agent</th><th>Status</th><th>Last seen</th><th className="text-right">Actions</th></tr></thead>
            <tbody>{rows.map((d) => (
              <tr key={d.id}>
                <td><p className="font-medium">{d.label}</p><p className="text-xs text-ink-500">{[d.os, d.browser].filter(Boolean).join(" · ")}</p></td>
                <td>{isIt ? (
                  <Select className="py-1 text-xs" value={d.student_id ?? ""} onChange={(e) => e.target.value && act("device_assign", { p_device: d.id, p_student: e.target.value }, "Reassigned")}>
                    <option value="">Unassigned</option>{students.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                  </Select>
                ) : d.users?.full_name ?? "—"}</td>
                <td className="text-xs">{d.agent_version ?? "—"}</td>
                <td>{online(d) ? <Badge tone="green" dot>online</Badge> : <Badge tone={d.status === "active" ? "gray" : "red"}>{d.status}</Badge>}</td>
                <td className="text-xs text-ink-500" title={formatDateTime(d.last_seen_at)}>{timeAgo(d.last_seen_at)}</td>
                <td className="text-right"><div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={async () => { try { setDiag(await rpc<Diag>("device_diagnostics", { p_device: d.id })); } catch (e) { toast(errorText(e), "error"); } }}>Diagnostics</Button>
                  {isIt && (d.status === "active"
                    ? <Button size="sm" variant="ghost" onClick={() => act("device_set_status", { p_device: d.id, p_status: "disabled" }, "Device disabled remotely")}>Disable</Button>
                    : <Button size="sm" variant="ghost" onClick={() => act("device_set_status", { p_device: d.id, p_status: "active" }, "Re-enabled")}>Enable</Button>)}
                  {isIt && d.status !== "unenrolled" && <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => confirm("Unenrol this device? The extension will stop working until paired again.") && act("device_set_status", { p_device: d.id, p_status: "unenrolled" }, "Unenrolled")}>Unenrol</Button>}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <Modal open={!!diag} onClose={() => setDiag(null)} title="Connection diagnostics" wide>
        {diag && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div><p className="text-ink-500">Connection</p><p className="font-semibold">{diag.online ? "Online" : `Offline${diag.seconds_since_seen !== null ? ` (${Math.round(diag.seconds_since_seen / 60)} min)` : ""}`}</p></div>
              <div><p className="text-ink-500">Status</p><p className="font-semibold">{diag.device.status}</p></div>
              <div><p className="text-ink-500">Agent</p><p className="font-semibold">{diag.device.agent_version ?? "unknown"}</p></div>
              <div><p className="text-ink-500">In live session</p><p className="font-semibold">{diag.student_in_live_session ? "Yes" : "No"}</p></div>
            </div>
            {!diag.online && <Alert tone="warn">No heartbeat for a while. Check that the browser is open and signed in to the managed profile, that the extension is enabled, and that the network allows the server address.</Alert>}
            <div><p className="mb-1 font-semibold">Recent commands</p>
              {diag.recent_commands.length === 0 ? <p className="text-ink-500">None.</p> : <ul className="space-y-1">{diag.recent_commands.map((c, i) => <li key={i}><Badge tone={c.status === "acked" ? "green" : c.status === "failed" ? "red" : "gray"}>{c.status}</Badge> {c.kind} {c.error && `: ${c.error}`} <span className="text-xs text-ink-500">{timeAgo(c.created_at)}</span></li>)}</ul>}</div>
            <div><p className="mb-1 font-semibold">Enrolment history</p>
              <ul className="space-y-1">{diag.enrollments.map((e, i) => <li key={i}>{e.student ?? "—"} · {e.method.replace("_", " ")} · {formatDateTime(e.created_at)}{e.revoked_at && ` · revoked ${formatDateTime(e.revoked_at)}`}</li>)}</ul></div>
          </div>
        )}
      </Modal>
    </div>
  );
}
