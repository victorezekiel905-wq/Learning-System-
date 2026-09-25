"use client";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Modal, useToast, useDialog } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { ALERT_LABEL, type RosterEntry, type SessionState } from "./types";
import { useRpc } from "@/lib/hooks";
import { errorText, rpc } from "@/lib/rpc";
import { cn, timeAgo } from "@/lib/utils";

export type Screen = { student_id: string; device_id: string | null; image: string; captured_at: string; url: string | null; stale: boolean; source?: "extension" | "web" };

const LEFT_KINDS = new Set(["environment_left", "domain_blocked"]);

function alertFor(state: SessionState, studentId: string) {
  return state.alerts.find((a) => a.student_id === studentId && a.status === "open" && !a.resolved_at && a.kind !== "connection_lost");
}

/** Is a screen source (extension or the lesson page's own share) currently sending frames? */
export function screenLive(r: RosterEntry) {
  return !!(r.device?.online || r.web?.sharing);
}

function placeholder(r: RosterEntry, captureOn = true) {
  if (!captureOn) return "Screen capture is turned off by your school.";
  if (r.web?.away_since) return r.web.away_reason ?? "Away from the lesson";
  if (r.device && !r.device.online) return "Connection lost";
  if (r.web?.unsupported) return "This device can't share its screen";
  if (!r.web?.sharing && !r.device) return "Not sharing their screen yet";
  return "Waiting for screen…";
}

/** The screen captured when a "left class" alert fired: what the student switched to. */
export function EvidenceButton({ eventId, student }: { eventId: string; student: string }) {
  const toast = useToast();
  const [img, setImg] = useState<string | null>(null);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={async () => {
        try {
          const r = await rpc<{ image: string | null }>("event_evidence", { p_event: eventId });
          if (r.image) setImg(r.image); else toast("No screenshot was kept for this alert.", "info");
        } catch (e) { toast(errorText(e), "error"); }
      }}><Icon name="image" className="h-4 w-4" /> Screen when they left</Button>
      <Modal open={!!img} onClose={() => setImg(null)} title={`${student}: screen when they left`}>
        {img && <img src={img} alt={`${student}'s screen when the alert fired`} className="w-full rounded-lg border border-ink-200" />}
      </Modal>
    </>
  );
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
  const here = (r: RosterEntry) => r.presence === "online" || r.presence === "idle";
  // Someone who left (closed the lesson, switched away, or has an open "left" alert)
  // stays in the main strip, at the top and in red, until the teacher deals with it;
  // otherwise closing the tab would quietly move them into "Not in class".
  const leftNow = (r: RosterEntry) => !!r.web?.away_since || !!alertFor(state, r.student_id) && LEFT_KINDS.has(alertFor(state, r.student_id)!.kind);
  const joined = state.roster.filter((r) => here(r) || (r.presence === "offline" && leftNow(r)))
    .sort((a, b) => Number(leftNow(b)) - Number(leftNow(a)));
  const away = state.roster.filter((r) => !joined.includes(r));
  const [showAway, setShowAway] = useState(false);

  const tile = (r: RosterEntry) => {
    const sc = screens[r.student_id];
    const alert = alertFor(state, r.student_id);
    const left = alert && LEFT_KINDS.has(alert.kind);
    const stepping = !left && !!r.web?.away_since; // away, still within the grace period
    const live = sc && !sc.stale && screenLive(r);
    return (
      <li key={r.student_id}>
        <button type="button" onClick={() => onFocus(r.student_id)} aria-pressed={focus === r.student_id}
          className={cn("block w-full overflow-hidden rounded-lg border-2 bg-white text-left transition-colors hover:bg-ink-50",
            focus === r.student_id ? "border-brand-500 ring-2 ring-brand-200" : left || stepping ? "border-rose-500 ring-2 ring-rose-200" : alert ? "border-amber-400" : "border-ink-200")}>
          <div className="relative aspect-video bg-ink-100">
            {live ? <img src={sc.image} alt={`${r.name}'s screen`} className="h-full w-full object-cover" />
              : <span className="grid h-full place-items-center px-1 text-center text-[10px] text-ink-500">{placeholder(r, state.settings.allow_screen_capture)}</span>}
            {left && <span className="absolute inset-x-0 bottom-0 animate-pulse2 bg-rose-600 px-1 py-0.5 text-center text-[10px] font-bold text-white">LEFT CLASS</span>}
            {stepping && <span className="absolute inset-x-0 bottom-0 animate-pulse2 bg-rose-600 px-1 py-0.5 text-center text-[10px] font-bold text-white">LEFT LESSON</span>}
            {live && <span className="absolute left-1 top-1 rounded bg-rose-600 px-1 text-[9px] font-bold text-white">LIVE</span>}
          </div>
          <p className="flex items-center justify-between gap-1 px-2 py-1 text-xs font-medium">
            <span className="truncate">{r.name}</span>
            {r.hand_raised && <Icon name="hand" className="h-3 w-3 shrink-0 text-amber-600" />}
          </p>
          {alert ? <p className={cn("truncate px-2 pb-1 text-[11px] font-medium", left ? "text-rose-700" : "text-amber-800")}>{ALERT_LABEL[alert.kind] ?? alert.kind}{alert.domain && `: ${alert.domain}`}</p>
            : stepping && r.web?.away_reason ? <p className="truncate px-2 pb-1 text-[11px] font-medium text-rose-700">{r.web.away_reason}</p> : null}
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <p className="flex items-center justify-between text-[13px] font-semibold text-ink-600">
        <span>Screens</span><span>{joined.filter(here).length} in class</span>
      </p>
      {joined.length === 0 && <p className="text-xs text-ink-500">Students appear here as soon as they join with the code.</p>}
      {/* Phones/tablets: a swipeable row above the lesson; laptops: a column on the left. */}
      <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:block lg:space-y-2 lg:overflow-visible lg:px-0 lg:pb-0 [&>li]:w-40 [&>li]:shrink-0 [&>li]:snap-start lg:[&>li]:w-auto">{joined.map(tile)}</ul>
      {away.length > 0 && (
        <div>
          <button className="flex items-center gap-1 text-[13px] font-medium text-ink-600 hover:text-ink-900" aria-expanded={showAway} onClick={() => setShowAway((v) => !v)}><Icon name={showAway ? "chevronDown" : "chevronRight"} className="h-3.5 w-3.5" />Not in class ({away.length})</button>
          {showAway && <ul className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 opacity-70 lg:mx-0 lg:block lg:space-y-2 lg:px-0 [&>li]:w-40 [&>li]:shrink-0 lg:[&>li]:w-auto">{away.map(tile)}</ul>}
        </div>
      )}
    </div>
  );
}

/** One student's screen, large, on the teacher's screen only. */
export function FocusView({ state, studentId, sessionId, onMinimize, live }: {
  state: SessionState; studentId: string; sessionId: string; onMinimize: () => void;
  /** Latest frame from the student's live channel (web screen sharing). */
  live?: Screen;
}) {
  const toast = useToast();
  const dialog = useDialog();
  const r = state.roster.find((x) => x.student_id === studentId);
  // Managed browsers upload frames to the database; web sharing streams them live.
  const stored = useRpc<{ image: string; captured_at: string; url: string | null; quality: string; stale: boolean } | null>(
    "session_screen", { p_session: sessionId, p_student: studentId }, [sessionId, studentId], { intervalMs: 3000, enabled: !!r?.device });
  const f = live && (!stored.data || stored.data.captured_at < live.captured_at)
    ? { image: live.image, captured_at: live.captured_at, url: null, quality: "live", stale: live.stale }
    : stored.data;
  const alert = alertFor(state, studentId);

  // Ask the student's page/extension for sharper frames while this view is open.
  useEffect(() => {
    if (!state.settings.allow_screen_capture) return;
    const ask = () => rpc("request_screenshot", { p_session: sessionId, p_student: studentId }).catch(() => {});
    void ask();
    const id = window.setInterval(ask, 10000);
    return () => window.clearInterval(id);
  }, [sessionId, studentId, state.settings.allow_screen_capture]);

  if (!r) return null;
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
            const text = await dialog.ask({ title: `Message ${r.name}`, body: "It pops up on their screen.", label: "Message", multiline: true, maxLength: 500, confirmLabel: "Send" });
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
      <p className="rounded-lg bg-ink-100 px-3 py-1.5 text-xs text-ink-600"><Icon name="lock" className="inline h-3.5 w-3.5 align-[-2px]" /> Only you can see this. Students' screens are unchanged and they still see your lesson.</p>
      {alert && (
        <Alert tone={LEFT_KINDS.has(alert.kind) ? "error" : "warn"} title={ALERT_LABEL[alert.kind] ?? alert.kind}>
          {alert.rule}{alert.domain && ` (${alert.domain})`}, {timeAgo(alert.created_at)}
          {alert.has_evidence && <span className="mt-2 block"><EvidenceButton eventId={alert.id} student={r.name} /></span>}
        </Alert>
      )}
      {!alert && r.web?.away_since && <Alert tone="warn" title="Away from the lesson">{r.web.away_reason}, {timeAgo(r.web.away_since)}. You'll get an alert if they don't come back.</Alert>}
      <div className="overflow-hidden rounded-xl border border-ink-200 bg-ink-900">
        {f?.image && !f.stale ? <img src={f.image} alt={`${r.name}'s screen`} className="mx-auto max-h-[70vh] w-full object-contain" />
          : <div className="grid aspect-video place-items-center p-6 text-center text-sm text-ink-300">
              {!state.settings.allow_screen_capture ? "Screen capture is turned off by your school."
                : r.web?.unsupported && !r.device ? "This student is on a phone or tablet, which can't share its screen from the browser."
                : !screenLive(r) ? "This student isn't sharing their screen right now."
                : "Waiting for the student's screen…"}
            </div>}
      </div>
      {f?.url && <p className="break-all text-xs text-ink-500">{f.url}</p>}
      {f?.quality === "thumbnail" && <Badge tone="gray">low-res; a sharper frame arrives within a few seconds</Badge>}
    </div>
  );
}
