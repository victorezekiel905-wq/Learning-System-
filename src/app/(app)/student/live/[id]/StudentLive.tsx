"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
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
import { useLoader, useNetwork, useRealtime, useRpc } from "@/lib/hooks";
import { useOfflineQueue } from "@/lib/offline-queue";
import { errorText, rpc } from "@/lib/rpc";

type StudentState = {
  session: { id: string; title: string; status: string; mode: string; current_slide: number; group_chat_enabled: boolean; responses_visible: boolean; class_id: string; teacher: string; environment_active: boolean };
  my_slide: number;
  active_activity: { id: string; kind: string; title: string } | null;
  spotlight: { me: boolean; show_to_class: boolean; anonymized: boolean } | null;
  hand: { id: string } | null;
  environment_notice: string | null;
  device_monitored: boolean;
  announcements: { id: string; body: string; created_at: string }[];
};

export function StudentLive({ sessionId, me, notice, consented }: { sessionId: string; me: { id: string; tenantId: string; name: string }; notice: string; consented: boolean }) {
  const toast = useToast();
  const { quality } = useNetwork();
  const { pending } = useOfflineQueue((m) => toast(`An offline answer was rejected: ${m}`, "error"));
  const st = useRpc<StudentState>("session_student_state", { p_session: sessionId }, [sessionId], { intervalMs: quality === "slow" ? 15000 : 8000 });
  const lesson = useLoader(() => rpc<{ slides: LearnerSlide[] }>("session_lesson", { p_session: sessionId }), [sessionId]);
  useRealtime(`stu:${sessionId}`, [
    { table: "class_sessions", filter: `id=eq.${sessionId}` },
    { table: "announcements", filter: `session_id=eq.${sessionId}` },
    { table: "spotlights", filter: `session_id=eq.${sessionId}` },
    { table: "environment_events", filter: `class_session_id=eq.${sessionId}` }
  ], () => void st.reload());

  const [ownSlide, setOwnSlide] = useState<number | null>(null);
  const [handMsg, setHandMsg] = useState("");
  const [chat, setChat] = useState<"none" | "teacher" | "group">("none");
  const [threadId, setThreadId] = useState<string | null>(null);
  const [ack, setAck] = useState(consented);
  const [lastAnnouncement, setLastAnnouncement] = useState<string | null>(null);

  const s = st.data;
  const paced = s?.session.mode === "student_paced";
  const slideIndex = paced ? (ownSlide ?? s?.my_slide ?? 0) : s?.session.current_slide ?? 0;
  const ann = useAnnotations(sessionId, slideIndex);
  const guard = useClassroomGuard(sessionId, { live: s?.session.status === "live", managedDevice: !!s?.device_monitored });

  // Presence heartbeat + idle detection (§3.4).
  useEffect(() => {
    let idle = false;
    let last = Date.now();
    const mark = () => { last = Date.now(); if (idle) { idle = false; void beat(); } };
    const beat = () => rpc("session_heartbeat", { p_session: sessionId, p_slide: paced ? slideIndex : null, p_status: idle ? "idle" : "online" }).catch(() => {});
    const id = window.setInterval(() => { idle = Date.now() - last > 120_000 || document.hidden; void beat(); }, 15_000);
    ["pointermove", "keydown", "visibilitychange"].forEach((e) => window.addEventListener(e, mark));
    void beat();
    return () => { window.clearInterval(id); ["pointermove", "keydown", "visibilitychange"].forEach((e) => window.removeEventListener(e, mark)); };
  }, [sessionId, paced, slideIndex]);

  useEffect(() => {
    const a = s?.announcements[0];
    if (a && a.id !== lastAnnouncement) {
      if (lastAnnouncement !== null) toast(`📣 ${a.body}`, "info");
      setLastAnnouncement(a.id);
    }
  }, [s?.announcements, lastAnnouncement, toast]);

  if (st.error && !s) return <div className="page"><Alert tone="error">{st.error}</Alert></div>;
  if (!s) return <div className="page text-sm text-ink-500">Joining…</div>;
  if (s.session.status !== "live") {
    return <div className="page max-w-xl"><Alert title="This session has ended">Thanks for taking part. <Link href="/student">Back to home</Link></Alert></div>;
  }

  const slides = lesson.data?.slides ?? [];
  const slide = slides.find((x) => x.position === slideIndex);
  const activeOnSlide = slide?.kind === "activity" && slide.activity?.id === s.active_activity?.id;

  async function openChat(kind: "teacher" | "group") {
    try {
      const id = kind === "teacher" ? await rpc<string>("open_direct_thread", { p_class: s!.session.class_id }) : await rpc<string>("open_group_thread", { p_session: sessionId });
      setThreadId(id); setChat(kind);
    } catch (e) { toast(errorText(e), "error"); }
  }

  return (
    <div className="page max-w-5xl space-y-4 bg-ink-50">
      <LockdownGate guard={guard} teacher={s.session.teacher} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-xs text-ink-500">Live with {s.session.teacher}</p><h1 className="text-xl font-bold">{s.session.title}</h1></div>
        <div className="flex flex-wrap items-center gap-2">
          {guard.sharing && <Badge tone="red"><span className="mr-1 inline-block h-2 w-2 animate-pulse2 rounded-full bg-rose-600" />Sharing screen with your teacher</Badge>}
          {guard.locked && <Badge tone="gray"><Icon name="lock" className="mr-1 inline h-3 w-3" />Lockdown</Badge>}
          {pending > 0 && <Badge tone="amber">{pending} answer(s) waiting to sync</Badge>}
          {quality === "offline" && <Badge tone="red">Offline</Badge>}
          {s.hand ? <Button variant="secondary" onClick={async () => { await rpc("lower_hand", { p_session: sessionId }); void st.reload(); }}><Icon name="hand" className="h-4 w-4 text-amber-600" /> Lower hand</Button>
            : <Button variant="secondary" onClick={async () => {
                const { error } = await createClient().from("raise_hands").insert({ tenant_id: me.tenantId, session_id: sessionId, student_id: me.id, message: handMsg.trim().slice(0, 500) });
                if (error) toast(error.message, "error"); else { setHandMsg(""); toast("Your teacher can see your hand is raised", "success"); void st.reload(); }
              }}><Icon name="hand" className="h-4 w-4" /> Raise hand</Button>}
          <Button variant="secondary" onClick={() => openChat("teacher")}><Icon name="chat" className="h-4 w-4" /> Ask teacher</Button>
          {s.session.group_chat_enabled && <Button variant="secondary" onClick={() => openChat("group")}># Class chat</Button>}
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
      {s.device_monitored && ack && <p className="text-xs text-ink-500">🔒 Managed session active: your teacher can see your current site and screen during class. <Link href="/student/device">Details</Link></p>}

      {s.spotlight?.show_to_class && !s.spotlight.me && <SpotlightView sessionId={sessionId} />}
      <StudentReceiver sessionId={sessionId} />

      {s.active_activity && !activeOnSlide && (
        <ActivityPlayer key={s.active_activity.id} activityId={s.active_activity.id} sessionId={sessionId} tenantId={me.tenantId} userId={me.id} />
      )}

      {s.session.mode === "front_of_class" && !s.active_activity ? (
        <Alert>Your teacher is presenting at the front of the class. Activities will appear here when they're opened.</Alert>
      ) : slide ? (
        <LessonStage slide={slide} sessionId={sessionId} tenantId={me.tenantId} userId={me.id}
          overlay={ann.strokes.length ? <svg viewBox={`0 0 ${BOARD_W} ${BOARD_H}`} className="h-full w-full"><StrokeLayer strokes={ann.strokes} /></svg> : undefined} />
      ) : lesson.loading ? <p className="text-sm text-ink-500">Loading lesson…</p> : !s.active_activity && <Alert>Waiting for your teacher…</Alert>}

      {paced && slides.length > 0 && (
        <div className="flex items-center justify-between">
          <Button variant="secondary" disabled={slideIndex <= 0} onClick={() => setOwnSlide(slideIndex - 1)}>← Previous</Button>
          <span className="text-sm text-ink-500">Slide {slideIndex + 1} of {slides.length}</span>
          <Button disabled={slideIndex >= slides.length - 1} onClick={() => setOwnSlide(slideIndex + 1)}>Next →</Button>
        </div>
      )}

      {s.announcements.length > 0 && (
        <div className="card p-4"><p className="mb-2 text-sm font-semibold">📣 Announcements</p>
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
      <p className="border-b border-ink-100 px-4 py-2 text-sm font-semibold">⭐ Spotlight: {view.data.student}</p>
      {view.data.image && !view.data.stale ? <img src={view.data.image} alt={`Screen shared by ${view.data.student}`} className="w-full" /> : <p className="p-6 text-center text-sm text-ink-500">Screen unavailable right now.</p>}
    </div>
  );
}
