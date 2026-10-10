"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ActivityPlayer } from "@/components/activities/ActivityPlayer";
import { ThreadView } from "@/components/chat/ThreadView";
import { Icon } from "@/components/Icon";
import { LockdownGate } from "@/components/live/LockdownGate";
import { StudentReceiver } from "@/components/live/RtcBroadcast";
import { BOARD_H, BOARD_W, StrokeLayer } from "@/components/slides/Whiteboard";
import { LessonStage, type LearnerSlide } from "@/components/student/LessonStage";
import { Alert, Badge, Button, Input, Modal, useToast } from "@/components/ui";
import { useAnnotations } from "@/lib/annotations";
import { useClassroomGuard } from "@/lib/classroom-guard";
import { createClient } from "@/lib/supabase/client";
import { useLoader, useNetwork, useRpc } from "@/lib/hooks";
import { listen, useSignal } from "@/lib/realtime";
import { StreakChip, type LiveTimer } from "@/components/game/LiveGame";
import { useOfflineQueue } from "@/lib/offline-queue";
import { errorText, rpc } from "@/lib/rpc";
import { FEATURES } from "@/lib/features";
import { BoardOverlay, EndScreen, Lobby, PausedOverlay, RevealedResults } from "@/components/live/StudentPhases";
import type { BoardEntry } from "@/components/live/Leaderboard";
import { TeamChip, useTeamScores } from "@/components/game/Teams";

type StudentState = {
  session: { id: string; title: string; status: string; mode: string; current_slide: number; group_chat_enabled: boolean; responses_visible: boolean; class_id: string | null; teacher: string; environment_active: boolean; settings?: { teams?: number };
    /** Live engine (0880): lobby, active, paused, ended. Missing before that update. */
    phase?: "lobby" | "active" | "paused" | "ended"; join_code?: string };
  me?: { name: string; avatar: string | null };
  participants?: number;
  summary?: { answered: number; correct: number } | null;
  /** Points (0890): own score and rank only; the top 5 while the teacher shows the board. */
  my?: { score: number; rank: number; of: number; streak: number } | null;
  leaderboard?: BoardEntry[] | null;
  /** Reveal (0900): the activity whose answers the teacher has shown. */
  revealed_activity_id?: string | null;
  my_slide: number;
  active_activity: { id: string; kind: string; title: string } | null;
  state_version?: number;
  /** Countdown on the question on screen (0940). */
  timer?: LiveTimer | null;
  server_now?: string;
  spotlight: { me: boolean; show_to_class: boolean; anonymized: boolean } | null;
  hand: { id: string } | null;
  environment_notice: string | null;
  device_monitored: boolean;
  announcements: { id: string; body: string; created_at: string }[];
};

type FastState = { v: number; phase?: StudentState["session"]["phase"]; status?: string; slide?: number; activity?: string | null; mode?: string };

/** The fetched state, with a newer broadcast (same version counter) applied on top. */
function withFast(base: StudentState | null | undefined, f: FastState | null): StudentState | null | undefined {
  if (!base || !f || f.v <= (base.state_version ?? Number.MAX_SAFE_INTEGER)) return base;
  const activity = f.activity === undefined ? base.active_activity
    : f.activity === null ? null : base.active_activity?.id === f.activity ? base.active_activity : { id: f.activity, kind: "", title: "" };
  return { ...base, active_activity: activity, session: { ...base.session, phase: f.phase ?? base.session.phase, status: f.status ?? base.session.status,
    current_slide: f.slide ?? base.session.current_slide, mode: f.mode ?? base.session.mode } };
}

export function StudentLive({ sessionId, me, notice, consented, guest = false }: {
  sessionId: string; me: { id: string; tenantId: string; name: string }; notice: string; consented: boolean;
  /** Joined with the code and a name: no chat, and "join another" when it ends. */
  guest?: boolean;
}) {
  const toast = useToast();
  const { quality } = useNetwork();
  const { pending } = useOfflineQueue((m) => toast(`An offline answer was rejected: ${m}`, "error"));
  // Lesson state is refetched when the teacher changes something (pushed signal,
  // or the version reported by the 10 s tick); the slow poll is only a safety net.
  const st = useRpc<StudentState>("session_student_state", { p_session: sessionId }, [sessionId], { intervalMs: quality === "slow" ? 120000 : 60000 });
  const lesson = useLoader(() => rpc<{ slides: LearnerSlide[] }>("session_lesson", { p_session: sessionId }), [sessionId]);
  useSignal(`session:${sessionId}`, ["state"], () => void st.reload(), { debounceMs: 150 });
  // The broadcast carries the new slide, phase and activity: show them at once, and let
  // the refetch above fill in the rest (score, board, reveal) a moment later.
  const [fast, setFast] = useState<FastState | null>(null);
  useEffect(() => listen(`session:${sessionId}`, (event, payload) => {
    const p = payload as FastState | null;
    if (event === "state" && p && typeof p.v === "number") setFast((f) => (f && f.v >= p.v ? f : p));
  }), [sessionId]);

  const [ownSlide, setOwnSlide] = useState<number | null>(null);
  const [handMsg, setHandMsg] = useState("");
  const [chat, setChat] = useState<"none" | "teacher" | "group">("none");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [ack, setAck] = useState(consented);
  const [lastAnnouncement, setLastAnnouncement] = useState<string | null>(null);

  const s = withFast(st.data, fast);
  // Server clock minus this device's clock, so every phone counts down together.
  const [skew, setSkew] = useState(0);
  useEffect(() => { if (st.data?.server_now) setSkew(new Date(st.data.server_now).getTime() - Date.now()); }, [st.data]);
  const paced = s?.session.mode === "student_paced";
  const teams = useTeamScores(sessionId, s?.my?.score, (s?.session.settings?.teams ?? 0) >= 2);
  const myTeam = (teams.data ?? []).find((t) => t.mine);
  const slideIndex = paced ? (ownSlide ?? s?.my_slide ?? 0) : s?.session.current_slide ?? 0;
  const ann = useAnnotations(sessionId, slideIndex);
  // One tick (presence, slide, focus, lockdown) every 10 s and on every change.
  const guard = useClassroomGuard(sessionId, {
    live: s?.session.status === "live", managedDevice: !!s?.device_monitored, userId: me.id,
    slide: paced ? slideIndex : null, spotlightToClass: !!(s?.spotlight?.me && s.spotlight.show_to_class)
  });
  const version = guard.directives?.state_version;
  const reloadState = st.reload;
  const seenVersion = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (version === undefined) return;
    if (seenVersion.current !== undefined && version !== seenVersion.current) void reloadState();
    seenVersion.current = version;
  }, [version, reloadState]);

  useEffect(() => {
    const a = s?.announcements[0];
    if (a && a.id !== lastAnnouncement) {
      if (lastAnnouncement !== null) toast(`Announcement: ${a.body}`, "info");
      setLastAnnouncement(a.id);
    }
  }, [s?.announcements, lastAnnouncement, toast]);

  if (st.error && !s) return <div className="page"><Alert tone="error">{st.error}{guest && <> <Link href="/join">Back to joining</Link></>}</Alert></div>;
  if (!s) return <div className="page text-sm text-ink-500">Joining…</div>;
  if (s.session.status === "scheduled") {
    return <div className="page max-w-xl"><Alert title="This lesson hasn't started yet">Keep this page open. It starts as soon as {s.session.teacher} begins the lesson.</Alert></div>;
  }
  const myName = s.me?.name ?? me.name;
  if (s.session.status !== "live" || s.session.phase === "ended") {
    return <EndScreen name={myName} avatar={s.me?.avatar ?? null} summary={s.summary ?? null} guest={guest} score={s.my ?? null} closedNote={s.session.mode === "student_paced" ? "This has closed. Your answers are saved." : undefined} />;
  }
  if (s.session.phase === "lobby") {
    return <Lobby sessionId={sessionId} title={s.session.title} teacher={s.session.teacher} name={myName} avatar={s.me?.avatar ?? null}
      participants={s.participants ?? 0} code={s.session.join_code ?? ""} onAvatar={() => void st.reload()} />;
  }

  const slides = lesson.data?.slides ?? [];
  const slide = slides.find((x) => x.position === slideIndex);
  const activeOnSlide = slide?.kind === "activity" && slide.activity?.id === s.active_activity?.id;
  const revealedId = s.revealed_activity_id ?? null;
  // Teacher-paced lessons play like a game: tiles and a countdown.
  const game = !paced ? { timer: s.timer ?? null, skew } : undefined;
  const slideRevealed = !!revealedId && slide?.kind === "activity" && slide.activity?.id === revealedId;

  async function openChat(kind: "teacher" | "group") {
    try {
      const id = kind === "teacher" ? await rpc<string>("open_direct_thread", { p_class: s!.session.class_id ?? "" }) : await rpc<string>("open_group_thread", { p_session: sessionId });
      setThreadId(id); setChat(kind);
    } catch (e) { toast(errorText(e), "error"); }
  }

  return (
    <div className="page max-w-5xl space-y-4 bg-ink-50">
      {s.session.phase === "paused" && <PausedOverlay teacher={s.session.teacher} />}
      {s.leaderboard && s.session.phase !== "paused" && <BoardOverlay entries={s.leaderboard} me={myName} my={s.my ?? null} />}
      <LockdownGate guard={guard} teacher={s.session.teacher} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs text-ink-500">{paced ? "From" : "Live with"} {s.session.teacher}</p><h1 className="text-xl font-bold">{s.session.title}</h1></div>
        <div className="flex flex-wrap items-center gap-2">
          {s.my && <span className="inline-flex items-center gap-2 rounded-lg bg-ink-950 px-3 py-1.5 text-sm font-semibold text-white" title="Your score and rank">
            <span className="font-display text-base font-extrabold tabular-nums text-accent-400">{s.my.score.toLocaleString()}</span>
            <span className="text-ink-300">#{s.my.rank} of {s.my.of}</span>
          </span>}
          {s.my && <StreakChip streak={s.my.streak} />}
          {myTeam && <TeamChip team={myTeam} />}
          {guard.sharing && <Badge tone="red"><span className="mr-1 inline-block h-2 w-2 animate-pulse2 rounded-full bg-rose-600" />Sharing screen with your teacher</Badge>}
          {guard.locked && <Badge tone="gray"><Icon name="lock" className="mr-1 inline h-3 w-3" />Lockdown</Badge>}
          {pending > 0 && <Badge tone="amber">{pending} answer(s) waiting to sync</Badge>}
          {quality === "offline" && <Badge tone="red">Offline</Badge>}
          {s.hand ? <Button variant="secondary" onClick={async () => { try { await rpc("lower_hand", { p_session: sessionId }); void st.reload(); } catch (e) { toast(errorText(e), "error"); } }}><Icon name="hand" className="h-4 w-4 text-amber-600" /> Lower hand</Button>
            : <Button variant="secondary" onClick={async () => {
                const { error } = await createClient().from("raise_hands").insert({ tenant_id: me.tenantId, session_id: sessionId, student_id: me.id, message: handMsg.trim().slice(0, 500) });
                if (error) toast(error.message, "error"); else { setHandMsg(""); toast("Your teacher can see your hand is raised", "success"); void st.reload(); }
              }}><Icon name="hand" className="h-4 w-4" /> Raise hand</Button>}
          {!guest && FEATURES.messaging && <Button variant="secondary" onClick={() => openChat("teacher")}><Icon name="chat" className="h-4 w-4" /> Ask teacher</Button>}
          {!guest && FEATURES.messaging && s.session.group_chat_enabled && <Button variant="secondary" onClick={() => openChat("group")}><Icon name="users" className="h-4 w-4" /> Class chat</Button>}
        </div>
      </div>

      {!s.hand && <Input value={handMsg} onChange={(e) => setHandMsg(e.target.value)} maxLength={500} placeholder="(Optional) what do you need help with? Then press Raise hand." className="max-w-md" />}

      {s.environment_notice && <Alert tone="warn" title="Please return to the lesson">{s.environment_notice}</Alert>}
      {s.spotlight?.me && <Alert tone="info" title="Your screen is being shared">Your teacher is showing your screen to the class{s.spotlight.anonymized ? " without your name" : ""}.</Alert>}
      {s.device_monitored && !ack && (
        <Alert title="This browser is managed by your school">
          <p>{notice}</p>
          <Button size="sm" className="mt-2" onClick={async () => { await rpc("accept_notice", { p_kind: "monitoring_notice" }).catch(() => {}); setAck(true); }}>I understand</Button>
        </Alert>
      )}
      {s.device_monitored && ack && <p className="text-xs text-ink-500"><Icon name="lock" className="inline h-3.5 w-3.5 align-[-2px]" /> Managed session active: your teacher can see your current site and screen during class. <Link href="/student/device">Details</Link></p>}

      {s.spotlight?.show_to_class && !s.spotlight.me && <SpotlightView sessionId={sessionId} />}
      <StudentReceiver sessionId={sessionId} />

      {s.active_activity && !activeOnSlide && s.active_activity.id !== revealedId && (
        <ActivityPlayer key={s.active_activity.id} activityId={s.active_activity.id} sessionId={sessionId} tenantId={me.tenantId} userId={me.id} live={game} />
      )}

      {s.session.mode === "front_of_class" && !s.active_activity ? (
        <Alert>Your teacher is presenting at the front of the class. Activities will appear here when they're opened.</Alert>
      ) : slideRevealed ? (
        <RevealedResults sessionId={sessionId} activityId={revealedId!} />
      ) : slide ? (
        <LessonStage slide={slide} sessionId={sessionId} tenantId={me.tenantId} userId={me.id} live={game}
          overlay={ann.strokes.length ? <svg viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} className="h-full w-full"><StrokeLayer strokes={ann.strokes} /></svg> : undefined} />
      ) : lesson.loading ? <p className="text-sm text-ink-500">Loading lesson…</p> : !s.active_activity && <Alert>Waiting for your teacher…</Alert>}

      {paced && slides.length > 0 && (
        <div className="flex items-center justify-between">
          <Button variant="secondary" disabled={slideIndex <= 0} onClick={() => setOwnSlide(slideIndex - 1)}><Icon name="chevronLeft" className="h-4 w-4" />Previous</Button>
          <span className="text-sm text-ink-500">Slide {slideIndex + 1} of {slides.length}</span>
          <Button disabled={slideIndex >= slides.length - 1} onClick={() => setOwnSlide(slideIndex + 1)}>Next<Icon name="chevronRight" className="h-4 w-4" /></Button>
        </div>
      )}

      {s.announcements.length > 0 && (
        <div className="card p-4"><p className="mb-2 text-sm font-semibold"><Icon name="megaphone" className="inline h-4 w-4 align-[-3px]" /> Announcements</p>
          <ul className="space-y-1 text-sm">{s.announcements.map((a) => <li key={a.id}>{a.body}</li>)}</ul></div>
      )}

      <Modal open={chat !== "none" && !!threadId} onClose={() => setChat("none")} title={chat === "group" ? "Class chat" : `Private chat with ${s.session.teacher}`}>
        {threadId && <ThreadView threadId={threadId} meId={me.id} className="h-[420px]" />}
      </Modal>
    </div>
  );
}

function SpotlightView({ sessionId }: { sessionId: string }) {
  const view = useRpc<{ student: string; image: string | null; stale: boolean } | null>("spotlight_view", { p_session: sessionId }, [sessionId], { intervalMs: 4000 });
  if (!view.data) return null;
  return (
    <div className="card overflow-hidden">
      <p className="border-b border-ink-100 px-4 py-2 text-sm font-semibold"><Icon name="star" className="inline h-4 w-4 align-[-3px]" /> Spotlight: {view.data.student}</p>
      {view.data.image && !view.data.stale ? <img src={view.data.image} alt={`Screen shared by ${view.data.student}`} className="w-full" /> : <p className="p-6 text-center text-sm text-ink-500">Screen unavailable right now.</p>}
    </div>
  );
}
