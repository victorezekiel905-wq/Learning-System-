"use client";
// Student side of the web classroom (no extension needed):
//  • shares the student's entire screen (the browser always asks the student)
//    and streams small frames to the teacher over the student's own private
//    Realtime channel screen:<session>:<student>. Frames never touch the
//    database, and are only sent while a teacher has the live room open;
//  • one "tick" (student_report) every 10 s and on every focus change reports
//    presence, the current slide and whether the lesson is in front. Under
//    lockdown the server turns a long enough absence into a "left the class"
//    alert; when leaving, one evidence frame is stored for that alert.
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { openChannel } from "@/lib/realtime";
import { rpc } from "@/lib/rpc";

export type GuardDirectives = {
  status: string;
  lockdown: boolean;
  away: boolean;
  reason: string | null;
  setting_up?: boolean;
  state_version?: number;
  /** Set by the operator (platform_config.student_tick_seconds); pages adopt it on the next tick. */
  tick_seconds?: number;
  current_slide?: number;
  active_activity_id?: string | null;
  capture: { enabled: boolean; send?: boolean; interval_seconds: number; high_quality: boolean };
};

/** A screen frame as broadcast to the teacher. */
export type LiveFrame = { image: string; width: number; height: number; quality: "thumbnail" | "spotlight"; at: number };

type FrameGrabber = { grabFrame(): Promise<ImageBitmap> };
// Chrome/Edge only (it keeps working while the lesson tab is in the background);
// elsewhere we fall back to drawing a <video> element.
const FrameCapture = () =>
  (globalThis as unknown as { ImageCapture?: new (track: MediaStreamTrack) => FrameGrabber }).ImageCapture;

const MAX_DB_FRAME = 380_000;      // stored evidence/spotlight frames (DB check constraint is 400 KB)
const MAX_LIVE_FRAME = 240_000;    // Realtime broadcast payloads stay well under the plan limit
const DEFAULT_TICK_S = 10;
const IDLE_AFTER_MS = 120_000;

function lessonInFront() {
  if (typeof document === "undefined") return true;
  if (document.hidden) return false;
  // Clicking into an embedded video/iframe moves focus there; that's still the lesson.
  return document.hasFocus() || document.activeElement?.tagName === "IFRAME";
}
const isFullscreen = () => typeof document !== "undefined" && !!document.fullscreenElement;

export function canShareScreen() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
}
export function canFullscreen() {
  return typeof document !== "undefined" && !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false;
}

export function useClassroomGuard(sessionId: string, opts: {
  live: boolean; managedDevice: boolean; userId: string; slide: number | null; spotlightToClass: boolean;
}) {
  const [sharing, setSharing] = useState(false);
  const [surface, setSurface] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [directives, setDirectives] = useState<GuardDirectives | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [supported] = useState(() => ({ share: canShareScreen(), fullscreen: canFullscreen() }));

  const stream = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const grabber = useRef<FrameGrabber | null>(null);
  const channel = useRef<RealtimeChannel | null>(null);      // joined socket channel
  const restChannel = useRef<RealtimeChannel | null>(null);  // same topic, for httpSend fallback
  const lastThumb = useRef(0);
  const lastInput = useRef(Date.now());
  const directivesRef = useRef<GuardDirectives | null>(null);
  directivesRef.current = directives;
  const slideRef = useRef(opts.slide);
  slideRef.current = opts.slide;
  const spotlightRef = useRef(opts.spotlightToClass);
  spotlightRef.current = opts.spotlightToClass;

  // Phones/tablets can't share a screen or go full screen from a web page:
  // they're only held to "keep the lesson open and in front".
  const unsupported = !supported.share || !supported.fullscreen;

  const report = useCallback(async (override?: Partial<{ visible: boolean; fullscreen: boolean; sharing: boolean }>) => {
    if (!opts.live) return;
    try {
      const d = await rpc<GuardDirectives>("student_report", {
        p_session: sessionId,
        p_visible: override?.visible ?? lessonInFront(),
        p_fullscreen: override?.fullscreen ?? isFullscreen(),
        p_sharing: (override?.sharing ?? !!stream.current?.active) || opts.managedDevice,
        p_surface: surface,
        p_unsupported: unsupported,
        p_slide: slideRef.current,
        p_idle: Date.now() - lastInput.current > IDLE_AFTER_MS
      });
      setDirectives(d);
    } catch { /* offline: the next tick retries */ }
  }, [sessionId, opts.live, opts.managedDevice, surface, unsupported]);

  /** Grabs one frame from the shared screen as a JPEG data URL under `maxBytes`. */
  const grab = useCallback(async (width: number, maxBytes: number) => {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || track.readyState !== "live") return null;
    let source: CanvasImageSource | null = null, sw = 0, sh = 0;
    if (grabber.current) {
      const bmp = await grabber.current.grabFrame();
      source = bmp; sw = bmp.width; sh = bmp.height;
    } else if (video.current && video.current.videoWidth) {
      source = video.current; sw = video.current.videoWidth; sh = video.current.videoHeight;
    }
    if (!source || !sw) return null;
    const scale = Math.min(1, width / sw);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * scale); canvas.height = Math.round(sh * scale);
    canvas.getContext("2d")!.drawImage(source, 0, 0, canvas.width, canvas.height);
    if ("close" in source && typeof source.close === "function") source.close();
    let q = 0.6, img = canvas.toDataURL("image/jpeg", q);
    while (img.length > maxBytes && q > 0.2) { q -= 0.15; img = canvas.toDataURL("image/jpeg", q); }
    return img.length > maxBytes ? null : { image: img, width: canvas.width, height: canvas.height };
  }, []);

  /** Live frame to the teacher over the private channel (no database write). */
  const sendLive = useCallback(async (quality: "thumbnail" | "spotlight") => {
    try {
      const f = await grab(quality === "spotlight" ? 1280 : 480, MAX_LIVE_FRAME);
      if (!f) return;
      const payload: LiveFrame = { ...f, quality, at: Date.now() };
      // Normally over the joined socket; if the channel couldn't be joined (e.g. a
      // network that blocks WebSockets), use Realtime's explicit HTTP send instead.
      if (channel.current) await channel.current.send({ type: "broadcast", event: "frame", payload });
      else if (restChannel.current) await restChannel.current.httpSend("frame", payload);
    } catch { /* a missed frame is fine */ }
  }, [grab]);

  /** Stored frame: evidence for a leave alert, or the class spotlight. */
  const storeFrame = useCallback(async (quality: "thumbnail" | "spotlight") => {
    try {
      const f = await grab(quality === "spotlight" ? 1280 : 480, MAX_DB_FRAME);
      if (!f) return;
      await rpc("student_screen_frame", { p_session: sessionId, p_image: f.image, p_width: f.width, p_height: f.height, p_quality: quality });
    } catch { /* a missed frame is fine */ }
  }, [grab, sessionId]);

  const stopShare = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null; grabber.current = null;
    if (video.current) video.current.srcObject = null;
    setSharing(false);
  }, []);

  /** Must be called from a click (browsers require it). */
  const startShare = useCallback(async () => {
    setShareError(null);
    if (!supported.share) { setShareError("This device can't share its screen from the browser."); return false; }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "monitor", frameRate: 5 } as MediaTrackConstraints,
        audio: false,
        // Chrome hints: offer the whole screen first, don't pre-select this tab.
        ...({ monitorTypeSurfaces: "include", selfBrowserSurface: "exclude", surfaceSwitching: "exclude" } as object)
      } as DisplayMediaStreamOptions);
      const track = s.getVideoTracks()[0];
      const kind = (track.getSettings() as { displaySurface?: string }).displaySurface ?? null;
      if (kind && kind !== "monitor") {
        s.getTracks().forEach((t) => t.stop());
        setShareError("Please choose “Entire screen” (not a window or tab) so your teacher can see your screen.");
        return false;
      }
      stream.current = s;
      const IC = FrameCapture();
      grabber.current = IC ? new IC(track) : null;
      if (!video.current) { video.current = document.createElement("video"); video.current.muted = true; video.current.playsInline = true; }
      video.current.srcObject = s;
      void video.current.play().catch(() => {});
      track.addEventListener("ended", () => { stopShare(); void report({ sharing: false }); });
      setSurface(kind); setSharing(true);
      lastThumb.current = 0;
      void report({ sharing: true });
      return true;
    } catch (e) {
      setShareError((e as Error).name === "NotAllowedError"
        ? "Screen sharing was cancelled. You need to share your screen to take part in this class."
        : "Couldn't start screen sharing. Try again, or ask your teacher.");
      return false;
    }
  }, [supported.share, report, stopShare]);

  /** Must be called from a click. */
  const enterFullscreen = useCallback(async () => {
    try { await document.documentElement.requestFullscreen({ navigationUI: "hide" }); } catch { /* denied */ }
  }, []);

  // Own private channel for live frames, open while sharing.
  useEffect(() => {
    if (!sharing || !opts.userId) return;
    let cancelled = false;
    let opened: RealtimeChannel | null = null;
    void openChannel(`screen:${sessionId}:${opts.userId}`).then((c) => {
      if (cancelled) { void createClient().removeChannel(c); return; }
      opened = c;
      restChannel.current = c;
      // Frames are only sent once the channel is actually joined (never via the REST fallback).
      c.subscribe((status) => {
        if (cancelled) return;
        channel.current = status === "SUBSCRIBED" ? c : null;
      });
    });
    return () => {
      cancelled = true;
      if (opened) void createClient().removeChannel(opened);
      channel.current = null;
      restChannel.current = null;
    };
  }, [sharing, sessionId, opts.userId]);

  // Focus / full-screen tracking: tick immediately on every change, else every tick interval.
  const tickMs = Math.min(Math.max(directives?.tick_seconds ?? DEFAULT_TICK_S, 5), 60) * 1000;
  useEffect(() => {
    if (!opts.live) return;
    let hiddenShot: number | undefined;
    let nudge: Notification | null = null;
    const onChange = () => {
      const v = lessonInFront(), f = isFullscreen();
      setVisible(v); setFullscreen(f);
      void report({ visible: v, fullscreen: f });
      window.clearTimeout(hiddenShot);
      const leftLesson = !v || (!f && !!directivesRef.current?.lockdown && canFullscreen());
      // Store what they switched to, as evidence for the teacher's alert.
      if (leftLesson) hiddenShot = window.setTimeout(() => void storeFrame("thumbnail"), 1500);
      // Under lockdown, pop a system notification over whatever they switched to (e.g. a game).
      if (leftLesson && directivesRef.current?.lockdown && typeof Notification !== "undefined" && Notification.permission === "granted") {
        nudge?.close();
        nudge = new Notification("Return to your lesson", {
          body: "You left the class. Your teacher has been notified.",
          tag: `swiftcipher-return-${sessionId}`, requireInteraction: true
        });
        nudge.onclick = () => { window.focus(); nudge?.close(); };
      } else if (!leftLesson) {
        nudge?.close(); nudge = null;
      }
    };
    const input = () => { lastInput.current = Date.now(); };
    const events: [EventTarget, string][] = [[document, "visibilitychange"], [document, "fullscreenchange"], [window, "blur"], [window, "focus"]];
    events.forEach(([t, e]) => t.addEventListener(e, onChange));
    ["pointermove", "keydown", "touchstart"].forEach((e) => window.addEventListener(e, input, { passive: true }));
    onChange();
    const tick = window.setInterval(() => void report(), tickMs);
    return () => {
      events.forEach(([t, e]) => t.removeEventListener(e, onChange));
      ["pointermove", "keydown", "touchstart"].forEach((e) => window.removeEventListener(e, input));
      window.clearInterval(tick); window.clearTimeout(hiddenShot); nudge?.close();
    };
  }, [opts.live, report, storeFrame, tickMs, sessionId]);

  // The slide changed (student-paced): tell the server now.
  useEffect(() => { if (opts.live && opts.slide !== null) void report(); }, [opts.slide, opts.live, report]);

  // Frames: thumbnails on the school's interval; sharp frames every ~2 s while the
  // teacher has this student open; stored spotlight frames while shown to the class.
  useEffect(() => {
    if (!sharing) return;
    const id = window.setInterval(() => {
      const d = directivesRef.current;
      if (!d || !d.capture.enabled) return;
      if (spotlightRef.current) { void storeFrame("spotlight"); return; }
      if (d.capture.send === false) return;
      if (d.capture.high_quality) { void sendLive("spotlight"); return; }
      const every = (d.capture.interval_seconds ?? 10) * 1000;
      if (Date.now() - lastThumb.current >= every) { lastThumb.current = Date.now(); void sendLive("thumbnail"); }
    }, 2000);
    return () => window.clearInterval(id);
  }, [sharing, sendLive, storeFrame]);

  // School turned capture off, or the class ended: stop sharing.
  useEffect(() => {
    if ((directives && !directives.capture.enabled) || !opts.live) stopShare();
  }, [directives, opts.live, stopShare]);
  useEffect(() => () => stopShare(), [stopShare]);

  const needShare = !!directives?.capture.enabled && !opts.managedDevice && supported.share;
  const needFullscreen = supported.fullscreen && !unsupported;
  const locked = !!directives?.lockdown;
  const blocked = locked && ((needShare && !sharing) || (needFullscreen && !fullscreen) || !visible);

  return {
    directives, sharing, fullscreen, visible, unsupported, shareError,
    needShare, needFullscreen, locked, blocked,
    startShare, stopShare, enterFullscreen
  };
}
