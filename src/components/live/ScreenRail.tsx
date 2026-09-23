"use client";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, useToast } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { ALERT_LABEL, type RosterEntry, type SessionState } from "./types";
import { useRpc } from "@/lib/hooks";
import { errorText, rpc } from "@/lib/rpc";
import { cn, timeAgo } from "@/lib/utils";

export type Screen = { student_id: string; device_id: string; image: string; captured_at: string; url: string | null; stale: boolean };

const LEFT_KINDS = new Set(["environment_left", "domain_blocked"]);

function alertFor(state: SessionState, studentId: string) {
  return state.alerts.find((a) => a.student_id === studentId && a.status === "open" && !a.resolved_at && a.kind !== "connection_lost");
}

/**
 * Left-hand strip on the teacher's live screen (§3.4 screen wall): every
 * student appears as soon as they join; a tile turns red the moment they
 * leave the class environment. Clicking a tile opens it large for the teacher
 * only; nothing changes on students' screens.
 */
export function ScreenRail({ state, screens, focus, onFocus }: {
  state: SessionState; screens: Record<string, Screen>; focus: string | null; onFocus: (id: string) => void;
}) {
  const joined = state.roster.filter((r) => r.presence === "online" || r.presence === "idle");
  const away = state.roster.filter((r) => !(r.presence === "online" || r.presence === "idle"));
  const [showAway, setShowAway] = useState(false);

  const tile = (r: RosterEntry) => {
    const sc = screens[r.student_id];
    const alert = alertFor(state, r.student_id);
    const left = alert && LEFT_KINDS.has(alert.kind);
    const live = sc && !sc.stale && r.device?.online;
    return (
      <li key={r.student_id}>
        <button type="button" onClick={() => onFocus(r.student_id)} aria-pressed={focus === r.student_id}
          className={cn("block w-full overflow-hidden rounded-lg border-2 bg-white text-left transition hover:shadow-md",
            focus === r.student_id ? "border-brand-500 ring-2 ring-brand-200" : left ? "border-rose-500 ring-2 ring-rose-200" : alert ? "border-amber-400" : "border-ink-200")}>
          <div className="relative aspect-video bg-ink-100">
            {live ? <img src={sc.image} alt={`${r.name}'s screen`} className="h-full w-full object-cover" />
              : <span className="grid h-full place-items-center px-1 text-center text-[10px] text-ink-500">
                  {!r.device ? "No managed device" : !r.device.online ? "Connection lost" : "Waiting for screen…"}</span>}
            {left && <span className="absolute inset-x-0 bottom-0 animate-pulse2 bg-rose-600 px-1 py-0.5 text-center text-[10px] font-bold text-white">LEFT CLASS</span>}
          </div>
          <p className="flex items-center justify-between gap-1 px-2 py-1 text-xs font-medium">
            <span className="truncate">{r.name}</span>
            {r.hand_raised && <Icon name="hand" className="h-3 w-3 shrink-0 text-amber-600" />}
          </p>
          {alert && <p className={cn("truncate px-2 pb-1 text-[10px]", left ? "text-rose-600" : "text-amber-700")}>{ALERT_LABEL[alert.kind] ?? alert.kind}{alert.domain && `: ${alert.domain}`}</p>}
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <p className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-ink-500">
        <span>Screens</span><span>{joined.length} in class</span>
      </p>
      {joined.length === 0 && <p className="text-xs text-ink-500">Students appear here as soon as they join with the code.</p>}
      <ul className="space-y-2">{joined.map(tile)}</ul>
      {away.length > 0 && (
        <div>
          <button className="text-xs font-medium text-ink-500" onClick={() => setShowAway((v) => !v)}>{showAway ? "▾" : "▸"} Not in class ({away.length})</button>
          {showAway && <ul className="mt-2 space-y-2 opacity-70">{away.map(tile)}</ul>}
        </div>
      )}
    </div>
  );
}

/** One student's screen, large, on the teacher's screen only. */
export function FocusView({ state, studentId, sessionId, onMinimize }: {
  state: SessionState; studentId: string; sessionId: string; onMinimize: () => void;
}) {
  const toast = useToast();
  const r = state.roster.find((x) => x.student_id === studentId);
  const frame = useRpc<{ image: string; captured_at: string; url: string | null; quality: string; stale: boolean } | null>(
    "session_screen", { p_session: sessionId, p_student: studentId }, [sessionId, studentId], { intervalMs: 3000 });
  const alert = alertFor(state, studentId);

  // Ask the extension for sharper frames while this view is open.
  useEffect(() => {
    if (!state.settings.allow_screen_capture) return;
    const ask = () => rpc("request_screenshot", { p_session: sessionId, p_student: studentId }).catch(() => {});
    void ask();
    const id = window.setInterval(ask, 15000);
    return () => window.clearInterval(id);
  }, [sessionId, studentId, state.settings.allow_screen_capture]);

  if (!r) return null;
  const f = frame.data;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">{r.name}</h2>
          <p className="text-xs text-ink-500">{r.device?.domain ?? "—"}{r.device?.tab_count ? ` · ${r.device.tab_count} tabs` : ""}{f && ` · updated ${timeAgo(f.captured_at)}`}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => rpc("request_screenshot", { p_session: sessionId, p_student: studentId }).then(() => toast("Fresh frame requested", "info")).catch((e) => toast(errorText(e), "error"))}>Refresh</Button>
          <Button size="sm" variant="secondary" onClick={async () => {
            const text = prompt(`Message to ${r.name}:`);
            if (text) { try { await rpc("issue_command", { p_session: sessionId, p_students: [studentId], p_kind: "message", p_payload: { text } }); toast("Sent", "success"); } catch (e) { toast(errorText(e), "error"); } }
          }}>Message</Button>
          {alert && LEFT_KINDS.has(alert.kind) && (
            <Button size="sm" variant="secondary" onClick={async () => {
              try { await rpc("issue_command", { p_session: sessionId, p_students: [studentId], p_kind: "message", p_payload: { text: "Your class session requires you to return to the lesson." } }); toast("Reminder sent", "success"); } catch (e) { toast(errorText(e), "error"); }
            }}>Send back to lesson</Button>
          )}
          <Button size="sm" onClick={onMinimize}><Icon name="x" className="h-4 w-4" /> Minimize</Button>
        </div>
      </div>
      <p className="rounded-lg bg-ink-100 px-3 py-1.5 text-xs text-ink-600">🔒 Only you can see this. Students' screens are unchanged and they still see your lesson.</p>
      {alert && <Alert tone={LEFT_KINDS.has(alert.kind) ? "error" : "warn"} title={ALERT_LABEL[alert.kind] ?? alert.kind}>{alert.rule}{alert.domain && ` (${alert.domain})`}, {timeAgo(alert.created_at)}</Alert>}
      <div className="overflow-hidden rounded-xl border border-ink-200 bg-ink-900">
        {f?.image && !f.stale ? <img src={f.image} alt={`${r.name}'s screen`} className="mx-auto max-h-[70vh] w-full object-contain" />
          : <div className="grid aspect-video place-items-center p-6 text-center text-sm text-ink-300">
              {!state.settings.allow_screen_capture ? "Screen capture is turned off by your school."
                : !r.device ? "This student has no managed browser paired, so their screen can't be shown."
                : !r.device.online ? "The student's device has lost connection."
                : "Waiting for the student's screen…"}
            </div>}
      </div>
      {f?.url && <p className="break-all text-xs text-ink-500">{f.url}</p>}
      {f?.quality === "thumbnail" && <Badge tone="gray">low-res; a sharper frame arrives within a few seconds</Badge>}
    </div>
  );
}
