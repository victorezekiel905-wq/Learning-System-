"use client";
import { useSecondsLeft } from "@/components/game/LiveGame";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Avatar, Badge, Button, Select, Tabs, Textarea, Toggle, useToast, useDialog } from "@/components/ui";
import { Icon } from "@/components/Icon";
import { ALERT_LABEL, type SessionState } from "@/components/live/types";
import { createClient } from "@/lib/supabase/client";
import { useNetwork, useNow, useRpc } from "@/lib/hooks";
import { useSignal } from "@/lib/realtime";
import { useScreenFeed } from "@/lib/screen-feed";
import { useTeacherPresence } from "@/lib/teacher-presence";
import { errorText, rpc } from "@/lib/rpc";
import { cn, formatJoinCode, timeAgo } from "@/lib/utils";
import { Critter } from "@/components/live/Critter";
import { JoinQr } from "@/components/live/JoinQr";
import { FEATURES } from "@/lib/features";
import { ControlBar } from "./ControlBar";
import { LessonPanel } from "./LessonPanel";
import { ResponsesPanel } from "./ResponsesPanel";
import { ScreensPanel } from "./ScreensPanel";
import { EnvironmentPanel } from "./EnvironmentPanel";
import { ChatPanel } from "./ChatPanel";
import { FocusView, ScreenRail, type Screen } from "@/components/live/ScreenRail";
import { TeamStandings, useTeamScores } from "@/components/game/Teams";

type Tab = "lesson" | "responses" | "screens" | "environment" | "chat";
export type Me = { id: string; tenantId: string; name: string };

const PRESENCE_DOT: Record<string, string> = { online: "bg-emerald-500", idle: "bg-amber-400", offline: "bg-ink-300", not_joined: "bg-ink-200", connecting: "bg-sky-400" };

export function LiveRoom({ sessionId, me, envs, scenes, initialTab = "lesson" }: { sessionId: string; me: Me; envs: { id: string; name: string }[]; scenes: { id: string; name: string }[]; initialTab?: Tab }) {
  const router = useRouter();
  const toast = useToast();
  const dialog = useDialog();
  const [tab, setTab] = useState<Tab>(initialTab);
  useTeacherPresence(sessionId);
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

  // Leaving and coming back, for students and guests alike:
  //  * closed the lesson or the browser: instant (the page says so as it closes);
  //  * switched away under lockdown: instant, with the reason;
  //  * went quiet (device off, battery, no internet): once the presence window passes.
  // Each rings the alarm (unless sound is off), pops up, and stays in the "Left" list
  // until they are back; coming back, or rejoining on another device, is announced too.
  const seen = useRef<Map<string, { here: boolean; away: string | null; name: string }> | null>(null);
  useEffect(() => {
    if (!s) return;
    const first = seen.current === null;
    const prev = seen.current ?? new Map<string, { here: boolean; away: string | null; name: string }>();
    const next = new Map<string, { here: boolean; away: string | null; name: string }>();
    const alarm = (title: string, why: string) => {
      toast(`${title}: ${why}`, "error");
      beep(880); window.setTimeout(() => beep(660), 380);
      osNotify(title, why);
    };
    for (const r of s.roster) {
      const here = r.presence === "online" || r.presence === "idle";
      const away = r.web?.away_since ?? null;
      next.set(r.student_id, { here, away, name: r.name });
      if (first) continue;
      const before = prev.get(r.student_id);
      if (away && !before?.away) {
        alarm(`${r.name} left the lesson`, r.web?.away_reason ?? "Left the lesson");
      } else if (before?.here && !here && !away) {
        alarm(`${r.name} lost connection`, "Their device went off or lost the internet. They can rejoin with the same code.");
      } else if (before && (!before.here || before.away) && here && !away) {
        toast(`${r.name} is back in the lesson`, "success");
      } else if (!before && here) {
        const earlier = [...prev.entries()].find(([id, v]) => id !== r.student_id && v.name.toLowerCase() === r.name.toLowerCase());
        if (earlier) toast(`${r.name} rejoined on another device`, "success");
      }
    }
    seen.current = next;
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

  // Game countdown (0940): shown here; answers are revealed when time is up, or when everyone has
  // answered a one-question activity (unless the teacher turned that off).
  const [skew, setSkew] = useState(0);
  useEffect(() => { if (s?.server_now) setSkew(new Date(s.server_now).getTime() - Date.now()); }, [s]);
  const timer = s?.timer ?? null;
  const timerLeft = useSecondsLeft(timer, skew);
  const autoRevealed = useRef<string | null>(null);
  useEffect(() => {
    const a = s?.activity, cur = s?.session;
    if (!a || !cur || a.revealed || (cur.phase ?? "active") !== "active") return;
    if (cur.settings?.timer === false || cur.settings?.auto_reveal === false) return;
    const everyone = a.questions.length === 1 && (a.joined ?? 0) > 0 && (a.answered ?? 0) >= (a.joined ?? 0);
    const out = !!timer && timer.activity_id === a.activity.id && timerLeft !== null && timerLeft <= 0;
    if (!everyone && !out) return;
    const key = `${a.activity.id}:${timer?.ends_at ?? ""}`;
    if (autoRevealed.current === key) return;
    autoRevealed.current = key;
    // A moment's grace so answers sent in the last second still count.
    window.setTimeout(() => {
      rpc("session_control", { p_session: sessionId, p_action: "reveal", p_args: {} }).then(() => state.reload()).catch(() => { /* revealed elsewhere */ });
    }, out ? 1200 : 600);
  }, [s, timer, timerLeft, sessionId, state]);

  // Keyboard: → next, ← back, L leaderboard, R reveal, P pause/resume, S start.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      const cur = s?.session;
      if (!cur) return;
      const ph = cur.phase ?? "active";
      const act = (action: string, args: Record<string, unknown> = {}) =>
        rpc("session_control", { p_session: sessionId, p_action: action, p_args: args }).then(() => state.reload()).catch((err) => toast(errorText(err), "error"));
      const k = e.key.toLowerCase();
      if (e.key === "ArrowRight" && ph === "active") { e.preventDefault(); void act("next"); }
      else if (e.key === "ArrowLeft" && ph === "active") { e.preventDefault(); void act("prev"); }
      else if (k === "s" && ph === "lobby") void act("start");
      else if (k === "p" && (ph === "active" || ph === "paused")) void act(ph === "active" ? "pause" : "resume");
      else if (k === "l" && ph !== "lobby") void act("leaderboard", { show: !cur.show_leaderboard });
      else if (k === "r" && ph === "active") void act("reveal");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s, sessionId, state, toast]);

  if (state.error && !s) return <div className="page"><Alert tone="error">{state.error}</Alert></div>;
  if (!s) return <div className="page text-sm text-ink-500">Connecting to the session…</div>;

  // Classroom monitoring is a per-school add-on (0870); databases before it count as on.
  const mon = s.settings.monitoring_enabled !== false;
  const joined = s.roster.filter((r) => r.presence === "online" || r.presence === "idle").length;
  const phase = s.session.phase ?? "active";
  async function control(action: "start" | "pause" | "resume" | "leaderboard" | "next" | "prev" | "reveal", args?: Record<string, unknown>) {
    try { await rpc("session_control", { p_session: sessionId, p_action: action, p_args: args ?? {} }); void state.reload(); }
    catch (e) { toast(errorText(e), "error"); }
  }
  const toggle = (id: string) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function end() {
    if (!(await dialog.confirm({ title: "End the session for everyone?", body: "Everyone sees their results, and the session report is saved.", tone: "danger", confirmLabel: "End session" }))) return;
    try { await rpc("end_session", { p_session: sessionId }); router.push(`/teacher/reports?session=${sessionId}`); }
    catch (e) { toast(errorText(e), "error"); }
  }

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] lg:min-h-[calc(100dvh-4rem)] flex-col">
      <ControlBar state={s} sessionId={sessionId} joined={joined} timer={timer} skew={skew} monitoring={mon}
        onControl={(a, args) => void control(a, args)} onEnd={() => void end()}
        onLockdown={async () => {
          try { await rpc("set_session_lockdown", { p_session: sessionId, p_on: !s.session.lockdown }); void state.reload(); toast(s.session.lockdown ? "Lockdown off" : "Lockdown on", "info"); }
          catch (e) { toast(errorText(e), "error"); }
        }} />

      <LeftList state={s} />

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

      <div className={cn("grid flex-1 grid-cols-[minmax(0,1fr)]", mon ? "lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,1fr)_300px]" : "xl:grid-cols-[minmax(0,1fr)_300px]")}>
        {mon && <aside className="min-w-0 border-b border-ink-200 bg-white p-3 lg:sticky lg:top-16 lg:max-h-[calc(100dvh-7.5rem)] lg:overflow-y-auto lg:border-b-0 lg:border-r" aria-label="Student screens">
          <ScreenRail state={s} screens={screens} focus={focus} onFocus={setFocus} onChanged={() => void state.reload()} />
        </aside>}
        <section className="min-w-0 p-4">
          {phase === "lobby" && !focus && <WaitingRoom state={s} onStart={() => control("start")} />}
          {phase === "lobby" && !focus ? null : focus ? <FocusView state={s} studentId={focus} sessionId={sessionId} onMinimize={() => setFocus(null)} live={screens[focus]?.source === "web" ? screens[focus] : undefined} /> : <>
          <Tabs className="mb-4" value={tab} onChange={setTab} tabs={[
            { id: "lesson", label: "Lesson" },
            { id: "responses", label: "Responses" },
            ...(mon ? [{ id: "screens" as Tab, label: "Screens" },
              { id: "environment" as Tab, label: "Environment", count: openAlerts.filter((a) => a.kind !== "connection_lost").length }] : []),
            ...(FEATURES.messaging ? [{ id: "chat" as Tab, label: "Chat" }] : [])
          ]} />
          {tab === "lesson" && <LessonPanel state={s} me={me} reload={state.reload} />}
          {tab === "responses" && <ResponsesPanel state={s} me={me} reload={state.reload} />}
          {tab === "screens" && <ScreensPanel state={s} sessionId={sessionId} selected={selected} setSelected={setSelected} reload={state.reload} screens={screens} />}
          {tab === "environment" && <EnvironmentPanel state={s} sessionId={sessionId} envs={envs} scenes={scenes} reload={state.reload} onView={setFocus} />}
          {tab === "chat" && <ChatPanel state={s} me={me} />}
          </>}
        </section>

        <aside className={cn("space-y-4 border-l border-ink-200 bg-ink-50 p-4 xl:col-span-1", mon && "lg:col-span-2")}>
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
                    {r.guest && <Badge tone="gray">Guest</Badge>}
                    {r.hand_raised && <Icon name="hand" className="h-3.5 w-3.5 text-amber-600" />}
                    {r.open_alerts > 0 && <Badge tone="red">{r.open_alerts}</Badge>}
                    {r.device && !r.device.online && <span title="Device connection lost"><Icon name="wifiOff" className="h-3.5 w-3.5 text-ink-500" /></span>}
                    {s.session.mode === "student_paced" && r.current_slide !== null && <span className="text-[10px] text-ink-500">S{r.current_slide + 1}</span>}
                  </label>
                </li>
              ))}
            </ul>
            {mon && <p className="mt-2 text-[11px] text-ink-500">Select students to send commands from the Screens tab.</p>}
          </div>

          {s.ranking && s.ranking.length > 0 && (
            <div className="card p-3">
              <p className="mb-2 text-sm font-semibold">Scores</p>
              <ol className="space-y-1 text-sm">{s.ranking.map((r) => (
                <li key={r.user_id} className="flex items-center gap-2">
                  <span className="w-5 text-right text-xs font-bold text-ink-500">{r.rank}</span>
                  <Critter name={r.avatar} className="h-5 w-5" />
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  {r.streak >= 2 && <span className="text-xs" title={`${r.streak} in a row`}>🔥{r.streak}</span>}
                  <span className="font-semibold tabular-nums">{r.score.toLocaleString()}</span>
                </li>
              ))}</ol>
            </div>
          )}

          <TeamsCard sessionId={sessionId} state={s} onChanged={() => void state.reload()} />

          <GuestControls sessionId={sessionId} state={s} monitoring={mon} onChanged={() => void state.reload()} />

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

/** Guests: anyone with the code and a name. The teacher decides whether they're monitored and when to stop new ones. */
function GuestControls({ sessionId, state, monitoring, onChanged }: { sessionId: string; state: SessionState; monitoring: boolean; onChanged: () => void }) {
  const toast = useToast();
  const guests = state.roster.filter((r) => r.guest);
  const set = async (args: { p_monitor?: boolean; p_closed?: boolean }, msg: string) => {
    try { await rpc("set_session_guests", { p_session: sessionId, ...args }); toast(msg, "success"); onChanged(); }
    catch (e) { toast(errorText(e), "error"); }
  };
  return (
    <div className="card space-y-3 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Guests ({guests.length})</p>
        <span className="text-[11px] text-ink-500">Code + name, no account</span>
      </div>
      <Toggle checked={!state.session.guests_closed} label="Let new guests join"
        description="Anyone with the code can join at /join by typing a name."
        onChange={(v) => void set({ p_closed: !v }, v ? "New guests can join" : "Closed to new guests")} />
      {monitoring && <Toggle checked={!!state.session.guest_monitoring} label="Monitor guests"
        description="Lockdown, screen sharing and leave alerts apply to guests too. Their screens are never captured where the school requires parental consent."
        onChange={(v) => void set({ p_monitor: v }, v ? "Guests are monitored" : "Guests are not monitored")} />}
      {guests.length > 0 && (
        <ul className="space-y-1 border-t border-ink-100 pt-2">{guests.map((g) => (
          <li key={g.student_id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">{g.name}</span>
            <Button size="sm" variant="ghost" className="text-rose-700" onClick={async () => {
              try { await rpc("remove_session_guest", { p_session: sessionId, p_user: g.student_id }); toast(`Removed ${g.name}`, "success"); onChanged(); }
              catch (e) { toast(errorText(e), "error"); }
            }}>Remove</Button>
          </li>
        ))}</ul>
      )}
    </div>
  );
}

/** The lobby, as the teacher sees it: how to join, who has joined, and Start. */
function WaitingRoom({ state, onStart }: { state: SessionState; onStart: () => void }) {
  const here = state.roster.filter((r) => r.presence === "online" || r.presence === "idle");
  const host = typeof window !== "undefined" ? window.location.host : "";
  return (
    <div className="mx-auto max-w-3xl rounded-3xl bg-ink-950 p-6 text-white sm:p-10">
      <p className="text-sm font-semibold text-accent-400">Waiting room</p>
      <h2 className="mt-2 font-display text-3xl font-extrabold tracking-tight">Students join at <span className="text-accent-400">{host}/join</span></h2>
      <p className="mt-4 font-mono text-6xl font-extrabold tracking-[0.2em] sm:text-7xl">{formatJoinCode(state.session.join_code)}</p>
      <JoinQr code={state.session.join_code} className="mt-6 w-40 rounded-xl bg-white p-2" />
      <p className="mt-6 text-ink-300">{here.length === 0 ? "Nobody has joined yet." : `${here.length} joined`}</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {here.map((r) => (
          <li key={r.student_id} className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm">
            <Critter name={r.avatar} className="h-5 w-5" />{r.name}
          </li>
        ))}
      </ul>
      <Button size="lg" variant="accent" className="mt-8" onClick={onStart}>Start lesson</Button>
      <p className="mt-2 text-sm text-ink-400">Students see the first slide as soon as you start. You can also use Present for the projector.</p>
    </div>
  );
}

/** Teams (migration 1090): 2 to 6 teams named after the answer tiles, balanced automatically, with their scores. */
function TeamsCard({ sessionId, state, onChanged }: { sessionId: string; state: SessionState; onChanged: () => void }) {
  const toast = useToast();
  const count = state.session.settings?.teams ?? 0;
  const teams = useTeamScores(sessionId, state.server_now, count >= 2);
  return (
    <div className="card space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">Teams</p>
        <Select className="w-auto py-1 text-xs" aria-label="Number of teams" value={String(count)} onChange={async (e) => {
          try { await rpc("set_session_teams", { p_session: sessionId, p_teams: Number(e.target.value) }); onChanged(); void teams.reload(); }
          catch (err) { toast(errorText(err), "error"); }
        }}>
          <option value="0">Off</option>{[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} teams</option>)}
        </Select>
      </div>
      {count >= 2 ? <TeamStandings teams={teams.data ?? []} light />
        : <p className="text-[12px] text-ink-500">Everyone is put in a team, balanced automatically; team scores show with the leaderboard.</p>}
    </div>
  );
}

/** Everyone who joined and has since gone (closed it, switched away under lockdown, or went quiet), until they're back. */
function LeftList({ state }: { state: SessionState }) {
  const gone = state.roster.filter((r) => r.presence === "offline" || !!r.web?.away_since);
  if (!gone.length) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-900">
      <strong>{gone.length === 1 ? "1 has" : `${gone.length} have`} left the lesson:</strong>
      {gone.map((r) => (
        <span key={r.student_id} className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-0.5 ring-1 ring-rose-200">
          <span className="font-semibold">{r.name}</span>{r.guest && <span className="text-[11px] text-rose-700">guest</span>}
          <span className="text-[12px] text-rose-800">{r.web?.away_since ? (r.web.away_reason ?? "left") : "lost connection"}, {timeAgo(r.web?.away_since ?? r.last_seen_at)}</span>
        </span>
      ))}
    </div>
  );
}
