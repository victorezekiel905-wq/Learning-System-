"use client";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, useToast } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useNetwork } from "@/lib/hooks";
import { errorText, rpc } from "@/lib/rpc";

/**
 * Teacher screen share / camera broadcast over WebRTC (§3.4, §15).
 * Star topology: the teacher sends one stream to each student; signalling
 * goes through the tenant-scoped rtc_* RPCs. Configure TURN for networks that
 * block peer-to-peer (NEXT_PUBLIC_TURN_URL / _USERNAME / _CREDENTIAL).
 */
const ICE: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    ...(process.env.NEXT_PUBLIC_TURN_URL ? [{ urls: process.env.NEXT_PUBLIC_TURN_URL, username: process.env.NEXT_PUBLIC_TURN_USERNAME, credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL }] : [])
  ]
};

type Peer = { peer_id: string; user_id: string; role: string; name: string };
type Signal = { id: number; from: string; kind: "offer" | "answer" | "ice" | "bye"; payload: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } };
type Poll = { signals: Signal[]; peers: Peer[]; open: boolean };

function usePoller(roomId: string | null, onPoll: (p: Poll) => Promise<void>) {
  const last = useRef(0);
  const cb = useRef(onPoll);
  cb.current = onPoll;
  useEffect(() => {
    if (!roomId) return;
    let stop = false;
    const loop = async () => {
      while (!stop) {
        try {
          const p = await rpc<Poll>("rtc_poll", { p_room: roomId, p_after: last.current });
          if (p.signals.length) last.current = p.signals[p.signals.length - 1]!.id;
          await cb.current(p);
          if (!p.open) break;
        } catch { /* transient */ }
        await new Promise((r) => setTimeout(r, 1500));
      }
    };
    void loop();
    return () => { stop = true; };
  }, [roomId]);
}

export function TeacherBroadcast({ sessionId }: { sessionId: string }) {
  const toast = useToast();
  const [roomId, setRoomId] = useState<string | null>(null);
  const [myPeer, setMyPeer] = useState<string | null>(null);
  const [viewers, setViewers] = useState(0);
  const stream = useRef<MediaStream | null>(null);
  const pcs = useRef(new Map<string, RTCPeerConnection>());
  const preview = useRef<HTMLVideoElement>(null);

  async function start(kind: "screen" | "camera") {
    try {
      stream.current = kind === "screen"
        ? await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 10 }, audio: false })
        : await navigator.mediaDevices.getUserMedia({ video: { width: 640 }, audio: true });
      stream.current.getVideoTracks()[0]?.addEventListener("ended", () => void stop());
      if (preview.current) { preview.current.srcObject = stream.current; void preview.current.play(); }
      const id = await rpc<string>("rtc_open_room", { p_session: sessionId, p_purpose: kind === "screen" ? "screen_share" : "av" });
      const j = await rpc<{ peer_id: string }>("rtc_join", { p_room: id });
      setMyPeer(j.peer_id);
      setRoomId(id);
    } catch (e) { toast(errorText(e), "error"); }
  }

  async function stop() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    pcs.current.forEach((pc) => pc.close());
    pcs.current.clear();
    if (roomId) await rpc("rtc_close", { p_room: roomId }).catch(() => {});
    setRoomId(null); setMyPeer(null); setViewers(0);
  }

  useEffect(() => () => { void stop(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  usePoller(roomId, async (p) => {
    if (!roomId || !myPeer || !stream.current) return;
    for (const peer of p.peers.filter((x) => x.role === "participant" && !pcs.current.has(x.peer_id))) {
      const pc = new RTCPeerConnection(ICE);
      pcs.current.set(peer.peer_id, pc);
      stream.current.getTracks().forEach((t) => pc.addTrack(t, stream.current!));
      pc.onicecandidate = (e) => { if (e.candidate) void rpc("rtc_signal", { p_room: roomId, p_to_peer: peer.peer_id, p_kind: "ice", p_payload: { candidate: e.candidate.toJSON() } }); };
      pc.onconnectionstatechange = () => { if (["failed", "closed"].includes(pc.connectionState)) { pc.close(); pcs.current.delete(peer.peer_id); } };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await rpc("rtc_signal", { p_room: roomId, p_to_peer: peer.peer_id, p_kind: "offer", p_payload: { sdp: offer } });
    }
    for (const s of p.signals) {
      const pc = pcs.current.get(s.from);
      if (!pc) continue;
      if (s.kind === "answer" && s.payload.sdp) await pc.setRemoteDescription(s.payload.sdp).catch(() => {});
      if (s.kind === "ice" && s.payload.candidate) await pc.addIceCandidate(s.payload.candidate).catch(() => {});
      if (s.kind === "bye") { pc.close(); pcs.current.delete(s.from); }
    }
    setViewers(Array.from(pcs.current.values()).filter((pc) => pc.connectionState === "connected").length);
  });

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Share with the class</p>
        {roomId ? <div className="flex items-center gap-2"><span className="text-xs text-ink-500">{viewers} watching</span><Button size="sm" variant="danger" onClick={stop}>Stop sharing</Button></div>
          : <div className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => start("screen")}>Share my screen</Button><Button size="sm" variant="secondary" onClick={() => start("camera")}>Start camera</Button></div>}
      </div>
      <video ref={preview} muted playsInline className={roomId ? "w-full rounded-lg bg-black" : "hidden"} />
      {!roomId && <p className="text-xs text-ink-500">Students see your screen or camera in their live lesson. Peer-to-peer; for large classes or strict networks, configure a TURN/SFU server.</p>}
    </div>
  );
}

export function StudentReceiver({ sessionId }: { sessionId: string }) {
  const { quality } = useNetwork();
  const [room, setRoom] = useState<{ id: string; purpose: string } | null>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [optIn, setOptIn] = useState(false);
  const pc = useRef<RTCPeerConnection | null>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const sb = createClient();
    const find = async () => {
      const { data } = await sb.from("rtc_rooms").select("id,purpose").eq("session_id", sessionId).eq("status", "open").order("created_at", { ascending: false }).limit(1).maybeSingle();
      setRoom(data as { id: string; purpose: string } | null);
    };
    void find();
    const ch = sb.channel(`rtc:${sessionId}`).on("postgres_changes" as never, { event: "*", schema: "public", table: "rtc_rooms", filter: `session_id=eq.${sessionId}` } as never, () => void find()).subscribe();
    const id = setInterval(find, 15000);
    return () => { clearInterval(id); void sb.removeChannel(ch); };
  }, [sessionId]);

  // §33: video is off by default on poor connections until the student opts in.
  const autoJoin = quality === "good" || optIn;
  useEffect(() => {
    if (!room || !autoJoin) return;
    let cancelled = false;
    rpc<{ peer_id: string }>("rtc_join", { p_room: room.id }).then(() => { if (!cancelled) setRoomId(room.id); }).catch(() => {});
    return () => { cancelled = true; pc.current?.close(); pc.current = null; if (room) void rpc("rtc_leave", { p_room: room.id }).catch(() => {}); setRoomId(null); };
  }, [room, autoJoin]);

  usePoller(roomId, async (p) => {
    if (!roomId) return;
    for (const s of p.signals) {
      if (s.kind === "offer" && s.payload.sdp) {
        pc.current?.close();
        const conn = new RTCPeerConnection(ICE);
        pc.current = conn;
        conn.ontrack = (e) => { if (video.current) { video.current.srcObject = e.streams[0]!; void video.current.play().catch(() => {}); } };
        conn.onicecandidate = (e) => { if (e.candidate) void rpc("rtc_signal", { p_room: roomId, p_to_peer: s.from, p_kind: "ice", p_payload: { candidate: e.candidate.toJSON() } }); };
        await conn.setRemoteDescription(s.payload.sdp);
        const answer = await conn.createAnswer();
        await conn.setLocalDescription(answer);
        await rpc("rtc_signal", { p_room: roomId, p_to_peer: s.from, p_kind: "answer", p_payload: { sdp: answer } });
      } else if (s.kind === "ice" && s.payload.candidate) {
        await pc.current?.addIceCandidate(s.payload.candidate).catch(() => {});
      }
    }
  });

  if (!room) return null;
  if (!autoJoin) return <Alert title="Your teacher is sharing video">Your connection is slow, so video is off. <Button size="sm" className="ml-2" onClick={() => setOptIn(true)}>Watch anyway</Button></Alert>;
  return (
    <div className="card overflow-hidden">
      <p className="border-b border-ink-100 px-4 py-2 text-sm font-semibold">{room.purpose === "screen_share" ? "Teacher's screen" : "Teacher's camera"}</p>
      <video ref={video} playsInline autoPlay controls className="w-full bg-black" />
    </div>
  );
}
