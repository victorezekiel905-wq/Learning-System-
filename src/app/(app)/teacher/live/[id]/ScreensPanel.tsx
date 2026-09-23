"use client";
import { useState } from "react";
import { Alert, Badge, Button, Field, Input, Modal, Toggle, useToast } from "@/components/ui";
import { Icon } from "@/components/Icon";
import type { SessionState } from "@/components/live/types";
import type { Screen } from "@/components/live/ScreenRail";
import { errorText, rpc } from "@/lib/rpc";
import { cn, timeAgo } from "@/lib/utils";

type Cmd = "open_tab" | "close_tab" | "redirect" | "focus" | "unfocus" | "lock" | "unlock" | "close_other_tabs" | "message";

/**
 * Screen wall (§3.4, §15) + teacher commands (§3.5) + spotlight (§3.7).
 * Thumbnails refresh at the school's configured interval; a frame older than
 * three intervals is shown as unavailable, never as live (§30).
 */
export function ScreensPanel({ state, sessionId, selected, setSelected, reload, screens: byStudent }: {
  state: SessionState; sessionId: string; selected: Set<string>; setSelected: (s: Set<string>) => void; reload: () => Promise<void>;
  screens: Record<string, Screen>;
}) {
  const toast = useToast();
  const [cmd, setCmd] = useState<Cmd | null>(null);
  const [url, setUrl] = useState("https://");
  const [text, setText] = useState("");
  const [spot, setSpot] = useState(false);
  const [anon, setAnon] = useState(false);
  const [toClass, setToClass] = useState(true);
  const [big, setBig] = useState<string | null>(null);
  const targets = Array.from(selected);

  async function send(kind: Cmd, payload: Record<string, unknown> = {}) {
    try {
      const r = await rpc<{ queued: number; results: { result: string }[] }>("issue_command", { p_session: sessionId, p_students: targets, p_kind: kind, p_payload: payload });
      const missing = r.results.filter((x) => x.result === "no_device").length;
      toast(`Sent to ${r.queued} device(s)${missing ? `; ${missing} student(s) have no connected device` : ""}`, missing ? "info" : "success");
      setCmd(null);
      void reload();
    } catch (e) { toast(errorText(e), "error"); }
  }

  const needsUrl = cmd === "open_tab" || cmd === "redirect" || cmd === "focus";

  return (
    <div className="space-y-4">
      {!state.settings.allow_screen_capture && <Alert tone="warn">Screen thumbnails are turned off by your school's policy. Tab and focus commands still work.</Alert>}

      <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-ink-200 bg-white p-2 shadow-sm">
        <span className="px-2 text-sm font-medium">{targets.length ? `${targets.length} selected` : "Select students"}</span>
        <Button size="sm" disabled={targets.length !== 1 || !state.settings.allow_spotlight} onClick={() => setSpot(true)} title={!state.settings.allow_spotlight ? "Disabled by school policy" : undefined}>
          <Icon name="star" className="h-4 w-4" /> Spotlight
        </Button>
        <Button size="sm" variant="secondary" disabled={!targets.length} onClick={() => setCmd("open_tab")}>Open tab</Button>
        <Button size="sm" variant="secondary" disabled={!targets.length} onClick={() => send("close_tab")}>Close tab</Button>
        <Button size="sm" variant="secondary" disabled={!targets.length} onClick={() => setCmd("redirect")}>Redirect</Button>
        <Button size="sm" variant="secondary" disabled={!targets.length} onClick={() => setCmd("focus")}>Focus</Button>
        <Button size="sm" variant="secondary" disabled={!targets.length} onClick={() => send("unfocus")}>Unfocus</Button>
        <Button size="sm" variant="secondary" disabled={!targets.length} onClick={() => send("lock")}><Icon name="lock" className="h-4 w-4" /> Lock</Button>
        <Button size="sm" variant="secondary" disabled={!targets.length} onClick={() => send("unlock")}>Unlock</Button>
        <Button size="sm" variant="secondary" disabled={!targets.length} onClick={() => setCmd("message")}>Message</Button>
        {state.spotlight && <Button size="sm" variant="danger" onClick={async () => { await rpc("spotlight_stop", { p_session: sessionId }); void reload(); }}>Stop spotlight</Button>}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-4">
        {state.roster.map((r) => {
          const sc = byStudent[r.student_id];
          const sel = selected.has(r.student_id);
          const alert = r.open_alerts > 0;
          const live = sc && !sc.stale && r.device?.online;
          return (
            <div key={r.student_id} className={cn("overflow-hidden rounded-xl border-2 bg-white text-left transition",
              sel ? "border-brand-500 ring-2 ring-brand-200" : alert ? "border-rose-300" : "border-ink-200",
              state.spotlight?.student_id === r.student_id && "ring-4 ring-amber-300")}>
              <button type="button" className="block w-full" onClick={() => { const n = new Set(selected); if (sel) n.delete(r.student_id); else n.add(r.student_id); setSelected(n); }}
                onDoubleClick={() => sc && setBig(r.student_id)} aria-pressed={sel} aria-label={`Select ${r.name}`}>
                <div className="relative aspect-video bg-ink-100">
                  {live ? <img src={sc.image} alt={`${r.name}'s screen`} className="h-full w-full object-cover" />
                    : <div className="grid h-full place-items-center text-center text-xs text-ink-500">
                        {!r.device ? "No managed device" : !r.device.online ? "Connection lost" : sc?.stale ? "Screen unavailable (stale)" : "Waiting for first frame"}
                      </div>}
                  {r.device?.focus_locked && <span className="absolute left-1 top-1"><Badge tone="brand">Focused</Badge></span>}
                  {sc && live && <span className="absolute bottom-1 right-1 rounded bg-black/60 px-1 text-[10px] text-white">{timeAgo(sc.captured_at)}</span>}
                </div>
              </button>
              <div className="space-y-0.5 px-2.5 py-2">
                <p className="flex items-center justify-between text-sm font-semibold">{r.name}{alert && <Badge tone="red">{r.open_alerts}</Badge>}</p>
                <p className="truncate text-xs text-ink-500" title={r.device?.url ?? ""}>{r.device?.domain ?? (r.device ? "browser page" : "—")}{r.device?.tab_count ? ` · ${r.device.tab_count} tabs` : ""}</p>
                {r.device?.violation && <p className="truncate text-xs text-rose-600">{r.device.violation}</p>}
                <div className="flex gap-1 pt-1">
                  <button className="text-[11px] font-medium text-brand-700" onClick={async () => { try { await rpc("request_screenshot", { p_session: sessionId, p_student: r.student_id }); toast("Fresh frame requested", "info"); } catch (e) { toast(errorText(e), "error"); } }}>Refresh</button>
                  {sc && <button className="text-[11px] font-medium text-brand-700" onClick={() => setBig(r.student_id)}>Enlarge</button>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {state.commands.length > 0 && (
        <div className="card overflow-hidden">
          <p className="border-b border-ink-100 px-4 py-2 text-sm font-semibold">Recent commands</p>
          <table className="table"><tbody>{state.commands.map((c) => (
            <tr key={c.id}><td>{c.student}</td><td className="capitalize">{c.kind.replace(/_/g, " ")}</td>
              <td><Badge tone={c.status === "acked" ? "green" : c.status === "failed" || c.status === "expired" ? "red" : "amber"}>{c.status === "acked" ? "done" : c.status}</Badge>{c.error && <span className="ml-1 text-xs text-ink-500">{c.error}</span>}</td>
              <td className="text-xs text-ink-500">{timeAgo(c.created_at)}</td>
              <td className="text-right">{(c.status === "failed" || c.status === "expired") && <Button size="sm" variant="ghost" onClick={async () => { await rpc("retry_command", { p_command: c.id }); void reload(); }}>Retry</Button>}</td></tr>
          ))}</tbody></table>
        </div>
      )}

      <Modal open={!!cmd} onClose={() => setCmd(null)} title={cmd === "message" ? "Send a message" : cmd === "focus" ? "Focus on a page" : cmd === "redirect" ? "Redirect" : "Open a tab"}
        footer={<><Button variant="ghost" onClick={() => setCmd(null)}>Cancel</Button><Button onClick={() => send(cmd!, needsUrl ? { url } : { text })}>Send to {targets.length}</Button></>}>
        {needsUrl ? <Field label="Web address" hint={cmd === "focus" ? "Students are kept on this page until you unfocus." : undefined}><Input value={url} onChange={(e) => setUrl(e.target.value)} /></Field>
          : <Field label="Message (shown as a notification on their device)"><Input maxLength={200} value={text} onChange={(e) => setText(e.target.value)} /></Field>}
      </Modal>

      <Modal open={spot} onClose={() => setSpot(false)} title="Spotlight this screen"
        footer={<><Button variant="ghost" onClick={() => setSpot(false)}>Cancel</Button><Button onClick={async () => {
          try { await rpc("spotlight_start", { p_session: sessionId, p_student: targets[0], p_anonymized: anon, p_show_to_class: toClass }); setSpot(false); void reload(); toast("Spotlight on. The student has been told.", "success"); }
          catch (e) { toast(errorText(e), "error"); }
        }}>Start spotlight</Button></>}>
        <div className="space-y-3">
          <p className="text-sm text-ink-600">The student sees a notice that their screen is being shared. Show it on the projector from <strong>Present</strong>.</p>
          <Toggle checked={anon} onChange={setAnon} label="Hide the student's name" />
          <Toggle checked={toClass} onChange={setToClass} label="Also show on students' screens" />
        </div>
      </Modal>

      <Modal open={!!big} onClose={() => setBig(null)} wide title={state.roster.find((r) => r.student_id === big)?.name ?? "Screen"}>
        {big && byStudent[big] && <><img src={byStudent[big].image} alt="Student screen" className="w-full rounded-lg" /><p className="mt-2 break-all text-xs text-ink-500">{byStudent[big].url}</p></>}
      </Modal>
    </div>
  );
}
