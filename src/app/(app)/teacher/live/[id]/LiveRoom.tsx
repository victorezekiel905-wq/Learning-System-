"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Avatar, Badge, Button, CopyButton, Tabs, Textarea, useToast } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { ALERT_LABEL, type SessionState } from "@/components/live/types";
import { createClient } from "@/lib/supabase/client";
import { useNetwork, useNow, useRpc } from "@/lib/hooks";
import { useSignal } from "@/lib/realtime";
import { useScreenFeed } from "@/lib/screen-feed";
import { errorText, rpc } from "@/lib/rpc";
import { cn, timeAgo } from "@/lib/utils";
import { LessonPanel } from "./LessonPanel";
import { ResponsesPanel } from "./ResponsesPanel";
import { ScreensPanel } from "./ScreensPanel";
import { EnvironmentPanel } from "./EnvironmentPanel";
import { ChatPanel } from "./ChatPanel";
import { FocusView, ScreenRail, type Screen } from "@/components/live/ScreenRail";

type Tab = "lesson" | "responses" | "screens" | "environment" | "chat";
export type Me = { id: string; tenantId: string; name: string };

const PRESENCE_DOT: Record<string, string> = { online: "bg-emerald-500", idle: "bg-amber-400", offline: "bg-ink-300", not_joined: "bg-ink-200", connecting: "bg-sky-400" };

export function LiveRoom({ sessionId, me, envs, scenes }: { sessionId: string; me: Me; envs: { id: string; name: string }[]; scenes: { id: string; name: string }[] }) {
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("lesson");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sound, setSound] = useState(true);
  const { quality } = useNetwork();
  // Roster, alerts and hands are pushed (staff:<session>); the poll is a safety net
  // and also tells students a teacher is watching (so they send screen frames).
  const state = useRpc<SessionState>("teacher_session_state", { p_session: sessionId }, [sessionId], { intervalMs: quality === "slow" ? 30000 : 15000 });
  useSignal(`staff:${sessionId}`, ["state", "roster", "alert", "hand"], () => void state.reload(), { debounceMs: 300, minGapMs: 1500 });

  const s = state.data;
  const captureOn = !!s?.settings.allow_screen_capture;
  // Live frames stream from each joined student's private channel (never stored).
  const joinedIds = useMemo(() => (s?.roster ?? []).filter((r) => r.presence === "online" || r.presence === "idle").map((r) => r.student_id), [s]);
  const feed = useScreenFeed(sessionId, joinedIds, captureOn);
  // Managed browsers (extension) still upload to the database: poll only if any exist.
  const hasDevices = (s?.roster ?? []).some((r) => r.device);
  const thumbEvery = Math.max(s?.settings.thumbnail_interval_seconds ?? 10, 5) * 1000;
  const screensQ = useRpc<Screen[]>("session_screens", { p_session: sessionId }, [sessionId], { intervalMs: thumbEvery, enabled: captureOn && hasDevices });
  const now = useNow(5000);
  const screens = useMemo(() => {
    const out: Record<string, Screen> = Object.fromEntries((screensQ.data ?? []).map((x) => [x.student_id, x]));
    const staleAfter = Math.max(thumbEvery * 3, 30_000);
    for (const [id, f] of Object.entries(feed)) {
      const at = new Date(f.receivedAt).toISOString();
      if (!out[id] || out[id].captured_at < at) {
        out[id] = { student_id: id, device_id: null, image: f.image, captured_at: at, url: null, stale: now - f.receivedAt > staleAfter, source: "web" };
      }
    }
    return out;
  }, [screensQ.data, feed, now, thumbEvery]);
  const [focus, setFocus] = useState<string | null>(null);

  const openAlerts = useMemo(() => (s?.alerts ?? []).filter((a) => a.status === "open" && !a.resolved_at), [s]);
  const lastAlert = useRef<string | null>(null);
  const beep = (freq: number) => {
    if (!sound) return;
    try {
      const ctx = new AudioContext();
      [0, 0.2].forEach((t) => {
        const o = ctx.createOscillator(); o.frequency.value = freq;
        o.connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.12);
      });
    } catch { /* audio blocked until the teacher interacts with the page */ }
  };
  const osNotify = (title: string, body?: string) => {
    if (document.hidden && typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body, tag: `swiftcipher-${title}` });
    }
  };

  // INSTANT: the moment a student's lesson leaves the screen (tab/app switch, game,
  // minimise, full screen exited, share stopped), pop up, beep and mark the tile red.
  // The formal alert (bell, log, screenshot) follows after the school's grace period.
  const awaySeen = useRef<Map<string, string | null> | null>(null);
  useEffect(() => {
    if (!s) return;
    const first = awaySeen.current === null;
    const prev = awaySeen.current ?? new Map<string, string | null>();
    for (const r of s.roster) {
      const now = r.web?.away_since ?? null;
      const before = prev.get(r.student_id) ?? null;
      if (!first && now && !before) {
        const why = r.web?.away_reason ?? "Left the lesson";
        toast(`${r.name} left the lesson: ${why}`, "error");
        beep(880);
        osNotify(`${r.name} left the lesson`, why);
      } else if (!first && !now && before) {
        toast(`${r.name} is back in the lesson`, "success");
      }
      prev.set(r.student_id, now);
    }
    awaySeen.current = prev;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  // Formal alerts (grace period passed, blocked sites, off-task): sound + browser notification.
  useEffect(() => {
    const newest = openAlerts.find((a) => a.kind !== "connection_lost");
    if (!newest || newest.id === lastAlert.current) return;
    if (lastAlert.current !== null) {
      // Already announced instantly when the student left; don't double-alert.
      const announced = newest.kind === "environment_left" && !!s?.roster.find((r) => r.student_id === newest.student_id)?.web?.away_since;
      if (!announced) {
        beep(newest.kind === "environment_left" || newest.kind === "domain_blocked" ? 880 : 660);
        toast(`${newest.student}: ${ALERT_LABEL[newest.kind] ?? newest.kind}. ${newest.rule}`, newest.kind === "off_task" ? "info" : "error");
        osNotify(`${newest.student}: ${ALERT_LABEL[newest.kind] ?? newest.kind}`, newest.rule);
      }
    }
    lastAlert.current = newest.id;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openAlerts, sound, toast]);

  if (state.error && !s) return <div className="page"><Alert tone="error">{state.error}</Alert></div>;
  if (!s) return <div className="page text-sm text-ink-500">Connecting to the session…</div>;

  const joined = s.roster.filter((r) => r.presence === "online" || r.presence === "idle").length;
  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function end() {
    if (!confirm("End the session for everyone? Attendance and a report are saved.")) return;
    try { await rpc("end_session", { p_session: sessionId }); router.push(`/teacher/reports?session=${sessionId}`); }
    catch (e) { toast(errorText(e), "error"); }
  }

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] lg:min-h-[calc(100dvh-4rem)] flex-col">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 bg-ink-950 px-4 py-3 text-white sm:px-6">
        <div className="min-w-0 flex-1 basis-60">
          <p className="truncate text-[13px] text-ink-400">{s.session.class_name}{s.session.lesson_title && ` · ${s.session.lesson_title}`}</p>
          <h1 className="flex items-center gap-2.5 text-lg font-bold text-white sm:text-xl">
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-rose-600 px-1.5 py-1 text-[11px] font-bold leading-none text-white">
              <span className="h-1.5 w-1.5 animate-pulse2 rounded-full bg-white" aria-hidden />LIVE</span>
            <span className="truncate">{s.session.title}</span>
          </h1>
        </div>
        <div className="flex items-stretch gap-2.5">
          <div className="rounded-xl bg-accent-500 px-3.5 py-1.5 text-accent-ink">
            <p className="text-[11px] font-semibold leading-tight">Join code</p>
            <p className="font-mono text-xl font-extrabold leading-tight tracking-[0.18em] sm:text-2xl">{s.session.join_code}</p>
          </div>
          <div className="rounded-xl border border-white/15 px-3.5 py-1.5">
            <p className="text-[11px] font-semibold leading-tight text-ink-400">Students</p>
            <p className="font-display text-xl font-extrabold leading-tight tabular-nums sm:text-2xl">{joined}<span className="text-ink-400">/{s.roster.length}</span></p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 [&_.btn-secondary:hover]:bg-white/15 [&_.btn-secondary]:border-white/20 [&_.btn-secondary]:bg-white/5 [&_.btn-secondary]:text-white">
          <Button size="sm" variant={s.session.lockdown ? "accent" : "secondary"} aria-pressed={s.session.lockdown}
            title={s.session.lockdown ? "Students must share their screen and stay in the full-screen lesson; leaving alerts you." : "Students can leave the lesson without an alert."}
            onClick={async () => {
              try { await rpc("set_session_lockdown", { p_session: sessionId, p_on: !s.session.lockdown }); void state.reload(); toast(s.session.lockdown ? "Lockdown off" : "Lockdown on", "info"); }
              catch (e) { toast(errorText(e), "error"); }
            }}><Icon name="lock" className="h-4 w-4" /> Lockdown {s.session.lockdown ? "on" : "off"}</Button>
          <CopyButton value={s.session.join_code} label="Copy code" />
          <Link href={`/present/${sessionId}`} target="_blank" className="btn btn-secondary btn-sm no-underline"><Icon name="monitor" className="h-4 w-4" /> Present</Link>
          <Link href={`/teacher/challenge/new?class=${s.session.class_id}&session=${sessionId}${s.session.active_activity_id ? `&activity=${s.session.active_activity_id}` : ""}`}
            className="btn btn-secondary btn-sm no-underline" title="Kahoot-style quiz game with a live leaderboard"><Icon name="trophy" className="h-4 w-4" /> Game</Link>
          <Button size="sm" variant="danger" onClick={end}>End session</Button>
        </div>
      </div>

      {openAlerts.filter((a) => a.kind !== "connection_lost").length > 0 && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-900" role="alert">
          <strong>{openAlerts.length} alert{openAlerts.length > 1 ? "s" : ""}:</strong>{" "}
          {openAlerts.slice(0, 3).map((a, i) => (
            <span key={a.id}>{i > 0 && ", "}
              <button className="font-medium underline decoration-dotted" title="View screen" onClick={() => setFocus(a.student_id)}>{a.student}</button>
              {` (${(ALERT_LABEL[a.kind] ?? a.kind).toLowerCase()})`}
            </span>
          ))}
          <button className="ml-2 font-semibold underline" onClick={() => { setFocus(null); setTab("environment"); }}>Review</button>
        </div>
      )}

      <div className="grid flex-1 grid-cols-[minmax(0,1fr)] lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,1fr)_300px]">
        <aside className="min-w-0 border-b border-ink-200 bg-white p-3 lg:sticky lg:top-16 lg:max-h-[calc(100dvh-7.5rem)] lg:overflow-y-auto lg:border-b-0 lg:border-r" aria-label="Student screens">
          <ScreenRail state={s} screens={screens} focus={focus} onFocus={setFocus} />
        </aside>
        <section className="min-w-0 p-4">
          {focus ? <FocusView state={s} studentId={focus} sessionId={sessionId} onMinimize={() => setFocus(null)} live={screens[focus]?.source === "web" ? screens[focus] : undefined} /> : <>
          <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
            { id: "lesson", label: "Lesson" },
            { id: "responses", label: "Responses" },
            { id: "screens", label: "Screens" },
            { id: "environment", label: "Environment", count: openAlerts.filter((a) => a.kind !== "connection_lost").length },
            { id: "chat", label: "Chat" }
          ]} />
          {tab === "lesson" && <LessonPanel state={s} me={me} reload={state.reload} />}
          {tab === "responses" && <ResponsesPanel state={s} me={me} reload={state.reload} />}
          {tab === "screens" && <ScreensPanel state={s} sessionId={sessionId} selected={selected} setSelected={setSelected} reload={state.reload} screens={screens} />}
          {tab === "environment" && <EnvironmentPanel state={s} sessionId={sessionId} envs={envs} scenes={scenes} reload={state.reload} onView={setFocus} />}
          {tab === "chat" && <ChatPanel state={s} me={me} />}
          </>}
        </section>

        <aside className="space-y-4 border-l border-ink-200 bg-ink-50 p-4 lg:col-span-2 xl:col-span-1">
          {s.hands.length > 0 && (
            <div className="card p-3">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><Icon name="hand" className="h-4 w-4 text-amber-600" /> Help queue ({s.hands.length})</p>
              <ul className="space-y-2">{s.hands.map((h) => (
                <li key={h.id} className="flex items-start justify-between gap-2 text-sm">
                  <span><span className="font-medium">{h.student}</span>{h.message && <span className="block text-xs text-ink-500">{h.message}</span>}<span className="block text-[11px] text-ink-500">{timeAgo(h.created_at)}</span></span>
                  <Button size="sm" variant="secondary" onClick={async () => { await rpc("resolve_hand", { p_hand: h.id }); void state.reload(); }}>Done</Button>
                </li>
              ))}</ul>
            </div>
          )}

          <div className="card p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">Roster</p>
              <button className="text-xs font-medium text-brand-700" onClick={() => setSelected(selected.size ? new Set() : new Set(s.roster.map((r) => r.student_id)))}>{selected.size ? "Clear" : "Select all"}</button>
            </div>
            <ul className="max-h-[50vh] space-y-1 overflow-y-auto">
              {s.roster.map((r) => (
                <li key={r.student_id}>
                  <label className={cn("flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-white", selected.has(r.student_id) && "bg-brand-50")}>
                    <input type="checkbox" checked={selected.has(r.student_id)} onChange={() => toggle(r.student_id)} />
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", PRESENCE_DOT[r.presence])} title={r.presence.replace("_", " ")} />
                    <Avatar name={r.name} className="h-6 w-6 text-[10px]" />
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    {r.hand_raised && <Icon name="hand" className="h-3.5 w-3.5 text-amber-600" />}
                    {r.open_alerts > 0 && <Badge tone="red">{r.open_alerts}</Badge>}
                    {r.device && !r.device.online && <span title="Device connection lost"><Icon name="wifiOff" className="h-3.5 w-3.5 text-ink-500" /></span>}
                    {s.session.mode === "student_paced" && r.current_slide !== null && <span className="text-[10px] text-ink-500">S{r.current_slide + 1}</span>}
                  </label>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-ink-500">Select students to send commands from the Screens tab.</p>
          </div>

          <Announce sessionId={sessionId} classId={s.session.class_id} me={me} />

          <div className="card space-y-2 p-3 text-sm">
            <p className="font-semibold">Alert delivery</p>
            <label className="flex items-center gap-2"><input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} /> Sound</label>
            {typeof Notification !== "undefined" && Notification.permission !== "granted" && (
              <Button size="sm" variant="secondary" onClick={() => Notification.requestPermission()}>Enable browser notifications</Button>
            )}
            <p className="text-[11px] text-ink-500">Bandwidth: {quality === "good" ? "good" : quality === "slow" ? "slow — refreshing less often" : "offline"}</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Announce({ sessionId, classId, me }: { sessionId: string; classId: string; me: Me }) {
  const toast = useToast();
  const [text, setText] = useState("");
  return (
    <div className="card space-y-2 p-3">
      <p className="flex items-center gap-1.5 text-sm font-semibold"><Icon name="megaphone" className="h-4 w-4" /> Announcement</p>
      <Textarea rows={2} value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="Shown to every student in the session" />
      <Button size="sm" disabled={!text.trim()} onClick={async () => {
        const { error } = await createClient().from("announcements").insert({ tenant_id: me.tenantId, class_id: classId, session_id: sessionId, author_id: me.id, body: text.trim() });
        if (error) toast(error.message, "error"); else { setText(""); toast("Announcement sent", "success"); }
      }}>Send to class</Button>
    </div>
  );
}
